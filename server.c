#define _WIN32_WINNT 0x0600
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <time.h>
#include <math.h>

#define PORT        9090
#define UDP_PORT    9091
#define MAX_CLIENTS 20
#define MAX_MSG     1024
#define RESP_SIZE   131072
#define MAX_REPORTS 50
#define MAX_UDP_ALERTS 10
#define MAX_LOCATION 120
#define MAX_DESCRIPTION 280

typedef struct {
    SOCKET sock;
    int    id;
    int    active;         // 1 = slot in use
    char   ip[64];
} Client;

static Client           clients[MAX_CLIENTS];
static CRITICAL_SECTION lock;                  // protects clients[] and next_id
static CRITICAL_SECTION reports_lock;
static CRITICAL_SECTION alerts_lock;
static CRITICAL_SECTION log_lock;
static SOCKET           listen_sock = INVALID_SOCKET;
static SOCKET           udp_sock = INVALID_SOCKET;
static volatile LONG    running = 1;
static int              next_id = 1;
static int              next_report_id = 1;

typedef struct {
    char id[20];
    char severity[16];
    char traffic[16];
    char priority[16];
    char explanation[96];
    char suggestion[192];
    char road[MAX_LOCATION + 1];
    char locality[MAX_LOCATION + 1];
    char description[MAX_DESCRIPTION + 1];
    char status[20];
    int priority_score;
    int immediate_danger;
    int has_coordinates;
    double latitude;
    double longitude;
    time_t submitted_at;
    time_t status_updated_at;
} Report;

static Report reports[MAX_REPORTS];
static int report_count = 0;

typedef struct {
    char id[20];
    char severity[16];
    char traffic[16];
    char road[MAX_LOCATION + 1];
    char locality[MAX_LOCATION + 1];
    char status[20];
    int immediate_danger;
    time_t received_at;
    time_t status_updated_at;
} UdpAlert;

static UdpAlert udp_alerts[MAX_UDP_ALERTS];
static int udp_alert_count = 0;
static int next_udp_alert_id = 1;

// print a line with a timestamp
static void print_log_prefix(void) {
    char ts[16];
    time_t t = time(NULL); struct tm tm;
    localtime_s(&tm, &t);
    strftime(ts, sizeof ts, "%H:%M:%S", &tm);
    printf("[%s] ", ts);
}

static void slog(const char *fmt, ...) {
    char msg[1500];
    va_list a; va_start(a, fmt); vsnprintf(msg, sizeof msg, fmt, a); va_end(a);
    EnterCriticalSection(&log_lock);
    print_log_prefix();
    printf("%s\n", msg);
    fflush(stdout);
    LeaveCriticalSection(&log_lock);
}

static void slog_json_response(int client_id, const char *response) {
    int depth = 0, in_string = 0, escaped = 0;
    const char *cursor = response;

    EnterCriticalSection(&log_lock);
    print_log_prefix();
    printf("Client #%d response sent:\n", client_id);
    while (*cursor && *cursor != '\r' && *cursor != '\n') {
        char ch = *cursor++;
        if (in_string) {
            putchar(ch);
            if (escaped) escaped = 0;
            else if (ch == '\\') escaped = 1;
            else if (ch == '"') in_string = 0;
            continue;
        }

        if (ch == '"') {
            in_string = 1;
            putchar(ch);
        } else if (ch == '{' || ch == '[') {
            char closing = ch == '{' ? '}' : ']';
            putchar(ch);
            if (*cursor == closing) {
                putchar(*cursor++);
            } else {
                depth++;
                putchar('\n');
                print_log_prefix();
                for (int i = 0; i < depth * 2; i++) putchar(' ');
            }
        } else if (ch == '}' || ch == ']') {
            depth--;
            putchar('\n');
            print_log_prefix();
            for (int i = 0; i < depth * 2; i++) putchar(' ');
            putchar(ch);
        } else if (ch == ',') {
            putchar(ch);
            putchar('\n');
            print_log_prefix();
            for (int i = 0; i < depth * 2; i++) putchar(' ');
        } else if (ch == ':') {
            printf(": ");
        } else {
            putchar(ch);
        }
    }
    putchar('\n');
    fflush(stdout);
    LeaveCriticalSection(&log_lock);
}

// keep calling send() until every byte has gone out
static int send_all(SOCKET s, const char *buf, int len) {
    int sent = 0;
    while (sent < len) {
        int n = send(s, buf + sent, len - sent, 0);
        if (n <= 0) return -1;
        sent += n;
    }
    return 0;
}

// read one line (up to '\n'). out must hold max+1 bytes.
// returns length (>=0), -1 = client gone/error, -2 = line was too long
static int recv_line(SOCKET s, char *out, int max) {
    int len = 0, too_long = 0;
    char c;
    while (1) {
        int n = recv(s, &c, 1, 0);
        if (n <= 0) return -1;
        if (c == '\n') break;
        if (c == '\r') continue;
        if (len < max) out[len++] = c; else too_long = 1;   // keep reading so we reach the '\n'
    }
    out[len] = '\0';
    return too_long ? -2 : len;
}

static int valid_report_field(const char *s, size_t max_len) {
    size_t len = strlen(s);
    if (!len || len > max_len) return 0;
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)s[i];
        if (c < 32 || c == '|') return 0;
    }
    return 1;
}

static int append_json_string(char *out, size_t cap, size_t *used, const char *s) {
    if (*used + 2 >= cap) return 0;
    out[(*used)++] = '"';
    for (size_t i = 0; s[i]; i++) {
        unsigned char c = (unsigned char)s[i];
        if (c == '"' || c == '\\') {
            if (*used + 2 >= cap) return 0;
            out[(*used)++] = '\\';
            out[(*used)++] = (char)c;
        } else if (c < 32) {
            if (*used + 6 >= cap) return 0;
            *used += (size_t)snprintf(out + *used, cap - *used, "\\u%04x", c);
        } else {
            if (*used + 1 >= cap) return 0;
            out[(*used)++] = (char)c;
        }
    }
    if (*used + 1 >= cap) return 0;
    out[(*used)++] = '"';
    out[*used] = '\0';
    return 1;
}

static int append_report_json(char *out, size_t cap, size_t *used, const Report *r) {
    int n = snprintf(out + *used, cap - *used, "{\"id\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, r->id)) return 0;
    n = snprintf(out + *used, cap - *used, ",\"severity\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, r->severity)) return 0;
    n = snprintf(out + *used, cap - *used, ",\"traffic\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, r->traffic)) return 0;
    n = snprintf(out + *used, cap - *used, ",\"immediateDanger\":%s",
                 r->immediate_danger ? "true" : "false");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    n = snprintf(out + *used, cap - *used, ",\"priority\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, r->priority)) return 0;
    n = snprintf(out + *used, cap - *used, ",\"priorityScore\":%d,\"explanation\":",
                 r->priority_score);
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, r->explanation)) return 0;
    n = snprintf(out + *used, cap - *used, ",\"suggestion\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, r->suggestion)) return 0;
    n = snprintf(out + *used, cap - *used, ",\"road\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, r->road)) return 0;
    n = snprintf(out + *used, cap - *used, ",\"locality\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, r->locality)) return 0;
    n = snprintf(out + *used, cap - *used, ",\"latitude\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    n = r->has_coordinates
        ? snprintf(out + *used, cap - *used, "%.7f", r->latitude)
        : snprintf(out + *used, cap - *used, "null");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    n = snprintf(out + *used, cap - *used, ",\"longitude\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    n = r->has_coordinates
        ? snprintf(out + *used, cap - *used, "%.7f", r->longitude)
        : snprintf(out + *used, cap - *used, "null");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    n = snprintf(out + *used, cap - *used, ",\"description\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, r->description)) return 0;
    n = snprintf(out + *used, cap - *used,
                 ",\"status\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, r->status)) return 0;
    n = snprintf(out + *used, cap - *used,
                 ",\"submittedAt\":%lld,\"statusUpdatedAt\":%lld}",
                 (long long)r->submitted_at, (long long)r->status_updated_at);
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    return 1;
}

static int append_alert_json(char *out, size_t cap, size_t *used, const UdpAlert *alert) {
    int n = snprintf(out + *used, cap - *used, "{\"id\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, alert->id)) return 0;
    n = snprintf(out + *used, cap - *used, ",\"severity\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, alert->severity)) return 0;
    n = snprintf(out + *used, cap - *used, ",\"traffic\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, alert->traffic)) return 0;
    n = snprintf(out + *used, cap - *used, ",\"immediateDanger\":%s",
                 alert->immediate_danger ? "true" : "false");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    n = snprintf(out + *used, cap - *used, ",\"road\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, alert->road)) return 0;
    n = snprintf(out + *used, cap - *used, ",\"locality\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, alert->locality)) return 0;
    n = snprintf(out + *used, cap - *used, ",\"status\":");
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    if (!append_json_string(out, cap, used, alert->status)) return 0;
    n = snprintf(out + *used, cap - *used,
                 ",\"receivedAt\":%lld,\"statusUpdatedAt\":%lld}",
                 (long long)alert->received_at,
                 (long long)alert->status_updated_at);
    if (n < 0 || (size_t)n >= cap - *used) return 0;
    *used += (size_t)n;
    return 1;
}

static int score_level(const char *value) {
    if (!_stricmp(value, "low")) return 1;
    if (!_stricmp(value, "medium")) return 2;
    if (!_stricmp(value, "high")) return 3;
    return 0;
}

static int parse_yes_no(const char *value, int *out) {
    if (!_stricmp(value, "yes")) {
        *out = 1;
        return 1;
    }
    if (!_stricmp(value, "no")) {
        *out = 0;
        return 1;
    }
    return 0;
}

static const char *suggestion_for_priority(const char *priority, int severity_score) {
    if (severity_score == 3)
        return "If anyone is hurt or in immediate danger, contact emergency services directly; this demo does not dispatch help. Notify the local road authority.";
    if (!strcmp(priority, "CRITICAL"))
        return "If anyone is hurt or in immediate danger, contact emergency services directly; this demo does not dispatch help. Notify the local road authority.";
    if (!strcmp(priority, "HIGH"))
        return "Ask the local road authority to inspect the hazard promptly.";
    if (!strcmp(priority, "MEDIUM"))
        return "Request an inspection and use caution near the pothole.";
    return "Monitor the pothole and report it again if it worsens.";
}

static void normalize_level(char *out, size_t cap, const char *input) {
    if (!_stricmp(input, "low")) snprintf(out, cap, "Low");
    else if (!_stricmp(input, "medium")) snprintf(out, cap, "Medium");
    else snprintf(out, cap, "High");
}

static int parse_coordinate(const char *text, double min, double max, double *value) {
    char *end;
    if (!text[0]) return 0;
    *value = strtod(text, &end);
    return end != text && *end == '\0' && isfinite(*value) &&
        *value >= min && *value <= max;
}

static int process_report(const char *msg, char *resp, size_t cap) {
    char fields[MAX_MSG + 1];
    char *severity, *traffic, *road, *locality, *latitude, *longitude, *description;
    char *immediate_danger;
    const char *priority, *priority_label;
    Report report = {0};

    if (strlen(msg) >= sizeof(fields)) {
        snprintf(resp, cap, "{\"ok\":false,\"error\":\"Report too large\"}");
        return 0;
    }
    strcpy(fields, msg + 7);
    severity = fields;
    traffic = strchr(severity, '|');
    if (!traffic) goto invalid;
    *traffic++ = '\0';
    road = strchr(traffic, '|');
    if (!road) goto invalid;
    *road++ = '\0';
    locality = strchr(road, '|');
    if (!locality) goto invalid;
    *locality++ = '\0';
    latitude = strchr(locality, '|');
    if (!latitude) goto invalid;
    *latitude++ = '\0';
    longitude = strchr(latitude, '|');
    if (!longitude) goto invalid;
    *longitude++ = '\0';
    description = strchr(longitude, '|');
    if (!description) goto invalid;
    *description++ = '\0';
    immediate_danger = strchr(description, '|');
    if (immediate_danger) {
        *immediate_danger++ = '\0';
        if (!parse_yes_no(immediate_danger, &report.immediate_danger)) goto invalid;
    }

    int severity_score = score_level(severity);
    int traffic_score = score_level(traffic);
    if (!severity_score || !traffic_score) goto invalid;
    if (!valid_report_field(road, MAX_LOCATION) ||
        !valid_report_field(locality, MAX_LOCATION) ||
        !valid_report_field(description, MAX_DESCRIPTION)) goto invalid;
    if (!!latitude[0] != !!longitude[0]) goto invalid;
    if (latitude[0] &&
        (!parse_coordinate(latitude, -90.0, 90.0, &report.latitude) ||
         !parse_coordinate(longitude, -180.0, 180.0, &report.longitude))) goto invalid;

    int score = severity_score + traffic_score;
    if (score == 2) { priority = "LOW"; priority_label = "Low"; }
    else if (score <= 4) { priority = "MEDIUM"; priority_label = "Medium"; }
    else if (score == 5) { priority = "HIGH"; priority_label = "High"; }
    else { priority = "CRITICAL"; priority_label = "Critical"; }

    EnterCriticalSection(&reports_lock);
    if (report_count >= MAX_REPORTS) {
        LeaveCriticalSection(&reports_lock);
        snprintf(resp, cap, "{\"ok\":false,\"error\":\"Report storage is full; restart the server to clear it\"}");
        return 0;
    }
    snprintf(report.id, sizeof(report.id), "PTH-%06d", next_report_id++);
    normalize_level(report.severity, sizeof(report.severity), severity);
    normalize_level(report.traffic, sizeof(report.traffic), traffic);
    snprintf(report.priority, sizeof(report.priority), "%s", priority);
    report.priority_score = score;
    snprintf(report.explanation, sizeof(report.explanation),
             "%s severity + %s traffic = %s priority.",
             report.severity, report.traffic, priority_label);
    snprintf(report.suggestion, sizeof(report.suggestion), "%s",
             report.immediate_danger
                 ? suggestion_for_priority("CRITICAL", 3)
                 : suggestion_for_priority(priority, severity_score));
    snprintf(report.road, sizeof(report.road), "%s", road);
    snprintf(report.locality, sizeof(report.locality), "%s", locality);
    snprintf(report.description, sizeof(report.description), "%s", description);
    report.has_coordinates = latitude[0] != '\0';
    snprintf(report.status, sizeof(report.status), "Pending");
    report.submitted_at = time(NULL);
    report.status_updated_at = report.submitted_at;
    reports[report_count++] = report;

    size_t used = (size_t)snprintf(resp, cap, "{\"ok\":true,\"report\":");
    int ok = used < cap && append_report_json(resp, cap, &used, &report);
    if (ok && used + 2 < cap) {
        resp[used++] = '}';
        resp[used] = '\0';
    } else {
        report_count--;
        next_report_id--;
        ok = 0;
    }
    LeaveCriticalSection(&reports_lock);
    if (!ok) snprintf(resp, cap, "{\"ok\":false,\"error\":\"Could not encode report\"}");
    return 0;

invalid:
    snprintf(resp, cap, "{\"ok\":false,\"error\":\"Invalid report fields\"}");
    return 0;
}

static void process_report_list(char *resp, size_t cap) {
    size_t used = (size_t)snprintf(resp, cap, "{\"ok\":true,\"reports\":[");
    int ok = used < cap;
    EnterCriticalSection(&reports_lock);
    for (int i = report_count - 1; ok && i >= 0; i--) {
        int n = snprintf(resp + used, cap - used, "%s", i == report_count - 1 ? "" : ",");
        if (n < 0 || (size_t)n >= cap - used) { ok = 0; break; }
        used += (size_t)n;
        ok = append_report_json(resp, cap, &used, &reports[i]);
    }
    LeaveCriticalSection(&reports_lock);
    if (ok && used + 2 < cap) {
        resp[used++] = ']';
        resp[used++] = '}';
        resp[used] = '\0';
    } else {
        snprintf(resp, cap, "{\"ok\":false,\"error\":\"Could not encode report list\"}");
    }
}

static void process_udp_alert_list(char *resp, size_t cap) {
    size_t used = (size_t)snprintf(resp, cap, "{\"ok\":true,\"alerts\":[");
    int ok = used < cap;
    EnterCriticalSection(&alerts_lock);
    for (int i = udp_alert_count - 1; ok && i >= 0; i--) {
        int n = snprintf(resp + used, cap - used, "%s",
                         i == udp_alert_count - 1 ? "" : ",");
        if (n < 0 || (size_t)n >= cap - used) { ok = 0; break; }
        used += (size_t)n;
        ok = append_alert_json(resp, cap, &used, &udp_alerts[i]);
    }
    LeaveCriticalSection(&alerts_lock);
    if (ok && used + 2 < cap) {
        resp[used++] = ']';
        resp[used++] = '}';
        resp[used] = '\0';
    } else {
        snprintf(resp, cap, "{\"ok\":false,\"error\":\"Could not encode alert list\"}");
    }
}

static int same_location_name(const char *left, const char *right) {
    return left[0] && right[0] && _stricmp(left, right) == 0;
}

static void process_duplicate_check(const char *msg, char *resp, size_t cap) {
    char fields[MAX_MSG + 1];
    char *road, *locality;
    if (strlen(msg) >= sizeof(fields)) {
        snprintf(resp, cap, "{\"ok\":false,\"error\":\"Duplicate check too large\"}");
        return;
    }
    strcpy(fields, msg + 6);
    road = fields;
    locality = strchr(road, '|');
    if (!locality) goto invalid;
    *locality++ = '\0';
    if (strchr(locality, '|') ||
        !valid_report_field(road, MAX_LOCATION) ||
        !valid_report_field(locality, MAX_LOCATION)) goto invalid;

    size_t used = (size_t)snprintf(resp, cap, "{\"ok\":true,\"matches\":[");
    int match_count = 0;
    int ok = used < cap;
    EnterCriticalSection(&reports_lock);
    for (int i = 0; ok && i < report_count; i++) {
        Report *r = &reports[i];
        if (!strcmp(r->status, "Resolved") ||
            (!same_location_name(road, r->road) &&
             !same_location_name(locality, r->locality))) continue;
        if (match_count) {
            if (used + 1 >= cap) { ok = 0; break; }
            resp[used++] = ',';
            resp[used] = '\0';
        }
        int n = snprintf(resp + used, cap - used, "{\"id\":");
        if (n < 0 || (size_t)n >= cap - used) { ok = 0; break; }
        used += (size_t)n;
        ok = append_json_string(resp, cap, &used, r->id);
        if (!ok) break;
        n = snprintf(resp + used, cap - used, ",\"road\":");
        if (n < 0 || (size_t)n >= cap - used) { ok = 0; break; }
        used += (size_t)n;
        ok = append_json_string(resp, cap, &used, r->road);
        if (!ok) break;
        n = snprintf(resp + used, cap - used, ",\"locality\":");
        if (n < 0 || (size_t)n >= cap - used) { ok = 0; break; }
        used += (size_t)n;
        ok = append_json_string(resp, cap, &used, r->locality);
        if (!ok) break;
        n = snprintf(resp + used, cap - used, ",\"status\":");
        if (n < 0 || (size_t)n >= cap - used) { ok = 0; break; }
        used += (size_t)n;
        ok = append_json_string(resp, cap, &used, r->status);
        if (!ok) break;
        if (used + 1 >= cap) { ok = 0; break; }
        resp[used++] = '}';
        resp[used] = '\0';
        match_count++;
    }
    LeaveCriticalSection(&reports_lock);
    if (ok) {
        int n = snprintf(resp + used, cap - used, "],\"duplicate\":%s}",
                         match_count ? "true" : "false");
        ok = n >= 0 && (size_t)n < cap - used;
    }
    if (!ok) snprintf(resp, cap, "{\"ok\":false,\"error\":\"Could not encode duplicate check\"}");
    return;

invalid:
    snprintf(resp, cap, "{\"ok\":false,\"error\":\"Invalid road or locality\"}");
}

static int valid_status(const char *status) {
    return !strcmp(status, "Pending") ||
        !strcmp(status, "Under Review") ||
        !strcmp(status, "In Progress") ||
        !strcmp(status, "Resolved");
}

static int process_udp_alert_status(const char *msg, char *response, size_t cap) {
    char fields[128];
    char *id, *status;
    if (strlen(msg + 13) >= sizeof(fields)) {
        snprintf(response, cap, "NACK|Invalid alert status request");
        return 0;
    }
    strcpy(fields, msg + 13);
    id = fields;
    status = strchr(id, '|');
    if (!status) goto invalid;
    *status++ = '\0';
    if (strchr(status, '|') || !valid_report_field(id, 19) ||
        !valid_status(status)) goto invalid;

    EnterCriticalSection(&alerts_lock);
    for (int i = 0; i < udp_alert_count; i++) {
        UdpAlert *alert = &udp_alerts[i];
        if (strcmp(alert->id, id)) continue;
        snprintf(alert->status, sizeof(alert->status), "%s", status);
        alert->status_updated_at = time(NULL);
        snprintf(response, cap, "ACK|STATUS|%s|%s", alert->id, alert->status);
        LeaveCriticalSection(&alerts_lock);
        return 1;
    }
    LeaveCriticalSection(&alerts_lock);
    snprintf(response, cap, "NACK|Alert not found");
    return 0;

invalid:
    snprintf(response, cap, "NACK|Invalid alert status request");
    return 0;
}

static int active_client_count(void) {
    int active = 0;
    EnterCriticalSection(&lock);
    for (int i = 0; i < MAX_CLIENTS; i++) {
        active += clients[i].active != 0;
    }
    LeaveCriticalSection(&lock);
    return active;
}

static Report *find_report_locked(const char *id) {
    for (int i = 0; i < report_count; i++) {
        if (!strcmp(reports[i].id, id)) return &reports[i];
    }
    return NULL;
}

static void write_report_response(char *resp, size_t cap, const Report *report) {
    size_t used = (size_t)snprintf(resp, cap, "{\"ok\":true,\"report\":");
    int ok = used < cap && append_report_json(resp, cap, &used, report);
    if (ok && used + 2 < cap) {
        resp[used++] = '}';
        resp[used] = '\0';
    } else {
        snprintf(resp, cap, "{\"ok\":false,\"error\":\"Could not encode report\"}");
    }
}

static void process_report_detail(const char *msg, char *resp, size_t cap) {
    const char *id = msg + 7;
    if (!valid_report_field(id, 19)) {
        snprintf(resp, cap, "{\"ok\":false,\"error\":\"Invalid report ID\"}");
        return;
    }
    EnterCriticalSection(&reports_lock);
    Report *report = find_report_locked(id);
    if (report) write_report_response(resp, cap, report);
    LeaveCriticalSection(&reports_lock);
    if (!report)
        snprintf(resp, cap, "{\"ok\":false,\"error\":\"Report not found\"}");
}

static void process_report_status(const char *msg, char *resp, size_t cap) {
    char fields[MAX_MSG + 1];
    char *id, *status;
    if (strlen(msg) >= sizeof(fields)) {
        snprintf(resp, cap, "{\"ok\":false,\"error\":\"Status request too large\"}");
        return;
    }
    strcpy(fields, msg + 7);
    id = fields;
    status = strchr(id, '|');
    if (!status) goto invalid;
    *status++ = '\0';
    if (strchr(status, '|') || !valid_report_field(id, 19) ||
        !valid_status(status)) goto invalid;

    EnterCriticalSection(&reports_lock);
    Report *report = find_report_locked(id);
    if (report) {
        snprintf(report->status, sizeof(report->status), "%s", status);
        report->status_updated_at = time(NULL);
        write_report_response(resp, cap, report);
    }
    LeaveCriticalSection(&reports_lock);
    if (!report)
        snprintf(resp, cap, "{\"ok\":false,\"error\":\"Report not found\"}");
    return;

invalid:
    snprintf(resp, cap, "{\"ok\":false,\"error\":\"Invalid report status request\"}");
}

// builds the reply in resp; returns 1 if the client asked to quit
static int process(const char *msg, char *resp, size_t n) {
    if (!strncmp(msg, "REPORT|", 7)) {
        return process_report(msg, resp, n);
    } else if (!strncmp(msg, "DETAIL|", 7)) {
        process_report_detail(msg, resp, n);
    } else if (!strncmp(msg, "STATUS|", 7)) {
        process_report_status(msg, resp, n);
    } else if (!strncmp(msg, "CHECK|", 6)) {
        process_duplicate_check(msg, resp, n);
    } else if (!strcmp(msg, "LIST")) {
        process_report_list(resp, n);
    } else if (!strcmp(msg, "ALERTS")) {
        process_udp_alert_list(resp, n);
    } else if (!strncmp(msg, "ALERT_STATUS|", 13)) {
        char status_resp[256];
        if (process_udp_alert_status(msg, status_resp, sizeof(status_resp))) {
            char ack_id[32] = {0}, ack_st[32] = {0};
            if (sscanf(status_resp, "ACK|STATUS|%31[^|]|%31[^|]", ack_id, ack_st) == 2) {
                snprintf(resp, n, "{\"ok\":true,\"id\":\"%s\",\"status\":\"%s\"}", ack_id, ack_st);
            } else {
                snprintf(resp, n, "{\"ok\":true,\"response\":\"%s\"}", status_resp);
            }
        } else {
            snprintf(resp, n, "{\"ok\":false,\"error\":\"%s\"}",
                     status_resp + (!strncmp(status_resp, "NACK|", 5) ? 5 : 0));
        }
    } else if (!strcmp(msg, "PING")) {
        snprintf(resp, n, "{\"ok\":true,\"server\":\"online\"}");
    } else if (!strcmp(msg, "STATS")) {
        int active = active_client_count();
        snprintf(resp, n,
                 "{\"ok\":true,\"serverBindAddress\":\"0.0.0.0\","
                 "\"tcpPort\":%d,\"udpPort\":%d,"
                 "\"activeClients\":%d,\"maxClients\":%d}",
                 PORT, UDP_PORT, active, MAX_CLIENTS);
    } else if (msg[strspn(msg, " \t")] == '\0') {
        snprintf(resp, n, "ERROR: Empty message. Please type something.");
    } else if (!strcmp(msg, "HELLO")) {
        snprintf(resp, n, "SUCCESS: Hello! Your request was received.");
    } else if (!strcmp(msg, "TIME")) {
        time_t t = time(NULL); struct tm tm; char ts[64];
        localtime_s(&tm, &t);
        strftime(ts, sizeof ts, "%d-%b-%Y %H:%M:%S", &tm);
        snprintf(resp, n, "SUCCESS: Server time is %s", ts);
    } else if (!strcmp(msg, "HELP")) {
        snprintf(resp, n, "Commands: HELLO | TIME | ECHO <message> | HELP | QUIT. Anything else is sent as a normal message.");
    } else if (!strcmp(msg, "QUIT")) {
        snprintf(resp, n, "Goodbye! Connection closing.");
        return 1;
    } else if (!strncmp(msg, "ECHO ", 5)) {
        snprintf(resp, n, "SUCCESS: Server echo: %s", msg + 5);
    } else {
        snprintf(resp, n, "Server received: %s", msg);
    }
    return 0;
}

static DWORD WINAPI udp_handler(LPVOID unused) {
    (void)unused;
    while (running) {
        char buffer[32768], response[32768];
        struct sockaddr_in sender;
        int sender_len = sizeof(sender);
        int n = recvfrom(udp_sock, buffer, (int)sizeof(buffer) - 1, 0,
                         (struct sockaddr *)&sender, &sender_len);
        if (n == SOCKET_ERROR) {
            if (!running) break;
            slog("UDP recvfrom failed: %d", WSAGetLastError());
            continue;
        }
        buffer[n] = '\0';
        if (!strncmp(buffer, "ALERT_V2|", 9) || !strncmp(buffer, "ALERT|", 6)) {
            int extended = !strncmp(buffer, "ALERT_V2|", 9);
            char *severity = buffer + (extended ? 9 : 6);
            char *traffic = NULL, *danger = NULL;
            char *road, *locality;
            if (extended) {
                traffic = strchr(severity, '|');
                if (!traffic) {
                    slog("Ignored invalid UDP datagram");
                    snprintf(response, sizeof(response), "NACK|Invalid alert");
                    sendto(udp_sock, response, (int)strlen(response), 0,
                           (struct sockaddr *)&sender, sender_len);
                    continue;
                }
                *traffic++ = '\0';
                danger = strchr(traffic, '|');
                if (!danger) {
                    slog("Ignored invalid UDP datagram");
                    snprintf(response, sizeof(response), "NACK|Invalid alert");
                    sendto(udp_sock, response, (int)strlen(response), 0,
                           (struct sockaddr *)&sender, sender_len);
                    continue;
                }
                *danger++ = '\0';
                road = strchr(danger, '|');
                if (!road) {
                    slog("Ignored invalid UDP datagram");
                    snprintf(response, sizeof(response), "NACK|Invalid alert");
                    sendto(udp_sock, response, (int)strlen(response), 0,
                           (struct sockaddr *)&sender, sender_len);
                    continue;
                }
                *road++ = '\0';
            } else {
                road = strchr(severity, '|');
            }
            if (!road) {
                slog("Ignored invalid UDP datagram");
                snprintf(response, sizeof(response), "NACK|Invalid alert");
                sendto(udp_sock, response, (int)strlen(response), 0,
                       (struct sockaddr *)&sender, sender_len);
                continue;
            }
            if (!extended) *road++ = '\0';
            locality = strchr(road, '|');
            if (!locality) {
                slog("Ignored invalid UDP datagram");
                snprintf(response, sizeof(response), "NACK|Invalid alert");
                sendto(udp_sock, response, (int)strlen(response), 0,
                       (struct sockaddr *)&sender, sender_len);
                continue;
            }
            *locality++ = '\0';
            int danger_value = 0;
            if (!score_level(severity) ||
                (extended && (!score_level(traffic) ||
                              !parse_yes_no(danger, &danger_value))) ||
                !valid_report_field(road, MAX_LOCATION) ||
                !valid_report_field(locality, MAX_LOCATION)) {
                slog("Ignored invalid UDP datagram");
                snprintf(response, sizeof(response), "NACK|Invalid alert");
                sendto(udp_sock, response, (int)strlen(response), 0,
                       (struct sockaddr *)&sender, sender_len);
                continue;
            }
            UdpAlert alert = {0};
            normalize_level(alert.severity, sizeof(alert.severity), severity);
            normalize_level(alert.traffic, sizeof(alert.traffic),
                            extended ? traffic : "Low");
            alert.immediate_danger = danger_value;
            snprintf(alert.road, sizeof(alert.road), "%s", road);
            snprintf(alert.locality, sizeof(alert.locality), "%s", locality);
            alert.received_at = time(NULL);
            alert.status_updated_at = alert.received_at;
            snprintf(alert.status, sizeof(alert.status), "Pending");
            EnterCriticalSection(&alerts_lock);
            snprintf(alert.id, sizeof(alert.id), "UDP-%06d", next_udp_alert_id++);
            if (udp_alert_count == MAX_UDP_ALERTS) {
                memmove(udp_alerts, udp_alerts + 1,
                        sizeof(udp_alerts[0]) * (MAX_UDP_ALERTS - 1));
                udp_alert_count--;
            }
            udp_alerts[udp_alert_count++] = alert;
            LeaveCriticalSection(&alerts_lock);

            char ip[64] = "unknown";
            InetNtopA(AF_INET, &sender.sin_addr, ip, sizeof(ip));
            slog("UDP alert %s received from %s:%u: %s severity, %s traffic, immediate danger: %s at %s, %s (Pending)",
                 alert.id, ip, ntohs(sender.sin_port), alert.severity,
                 alert.traffic, alert.immediate_danger ? "yes" : "no",
                 alert.road, alert.locality);
            snprintf(response, sizeof(response), "ACK|OK|%s", alert.id);
            if (sendto(udp_sock, response, (int)strlen(response), 0,
                       (struct sockaddr *)&sender, sender_len) == SOCKET_ERROR) {
                slog("Could not acknowledge UDP alert to %s:%u (Winsock error %d)",
                     ip, ntohs(sender.sin_port), WSAGetLastError());
            }
        } else if (!strcmp(buffer, "ALERTS")) {
            process_udp_alert_list(response, sizeof(response));
            if (sendto(udp_sock, response, (int)strlen(response), 0,
                       (struct sockaddr *)&sender, sender_len) == SOCKET_ERROR) {
                slog("Could not send UDP alert list (Winsock error %d)", WSAGetLastError());
            }
        } else if (!strncmp(buffer, "ALERT_STATUS|", 13)) {
            if (process_udp_alert_status(buffer, response, sizeof(response))) {
                slog("UDP alert status updated: %s", response);
            } else {
                slog("Rejected UDP alert status request: %s", response);
            }
            if (sendto(udp_sock, response, (int)strlen(response), 0,
                       (struct sockaddr *)&sender, sender_len) == SOCKET_ERROR) {
                slog("Could not reply to UDP status request (Winsock error %d)",
                     WSAGetLastError());
            }
        } else {
            slog("Ignored invalid UDP datagram");
        }
    }
    return 0;
}

// one of these runs per connected client
static DWORD WINAPI handler(LPVOID p) {
    Client *c = (Client *)p;
    int client_id = c->id;
    char msg[MAX_MSG + 1], resp[RESP_SIZE];

    while (running) {
        int n = recv_line(c->sock, msg, MAX_MSG), quit = 0;
        if (n == -1) { slog("Client #%d (%s) closed its TCP connection", c->id, c->ip); break; }

        if (n == -2) {
            slog("Client #%d sent an oversized message (rejected)", c->id);
            snprintf(resp, RESP_SIZE - 2, "ERROR: Message too long (max %d characters).", MAX_MSG);
        } else {
            slog("Client #%d (%s) sent: \"%s\"", c->id, c->ip, msg);
            slog("Client #%d processing request...", c->id);
            quit = process(msg, resp, RESP_SIZE - 2);
        }

        int len = (int)strlen(resp);
        resp[len] = '\n'; resp[len + 1] = '\0';          // every reply ends with '\n'
        if (send_all(c->sock, resp, len + 1) < 0) {
            slog("Client #%d: send failed (Winsock error %d)", c->id, WSAGetLastError());
            break;
        }
        if (resp[0] == '{' || resp[0] == '[')
            slog_json_response(c->id, resp);
        else
            slog("Client #%d response sent: %.*s", c->id, len, resp);
        if (quit) { slog("Client #%d quit", c->id); break; }
    }

    closesocket(c->sock);
    EnterCriticalSection(&lock);
    c->sock = INVALID_SOCKET;
    c->active = 0;                                        // slot can be reused now
    LeaveCriticalSection(&lock);
    slog("Client #%d disconnected; active TCP clients: %d/%d",
         client_id, active_client_count(), MAX_CLIENTS);
    return 0;
}

// stop accepting new clients (safe to call more than once)
static void stop_server(void) {
    if (InterlockedExchange(&running, 0)) {
        if (listen_sock != INVALID_SOCKET) closesocket(listen_sock);
        if (udp_sock != INVALID_SOCKET) closesocket(udp_sock);
    }
}

static BOOL WINAPI on_ctrl(DWORD type) {
    if (type == CTRL_C_EVENT || type == CTRL_BREAK_EVENT) {
        slog("Ctrl+C received, shutting down...");
        stop_server();
        return TRUE;
    }
    return FALSE;
}

int main(void) {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) { printf("WSAStartup failed\n"); return 1; }
    InitializeCriticalSection(&lock);
    InitializeCriticalSection(&reports_lock);
    InitializeCriticalSection(&alerts_lock);
    InitializeCriticalSection(&log_lock);
    SetConsoleCtrlHandler(on_ctrl, TRUE);

    listen_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listen_sock == INVALID_SOCKET) { printf("socket() failed: %d\n", WSAGetLastError()); return 1; }

    struct sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(PORT);

    if (bind(listen_sock, (struct sockaddr *)&addr, sizeof addr) == SOCKET_ERROR) {
        printf("bind() failed: %d (is port %d already in use?)\n", WSAGetLastError(), PORT);
        closesocket(listen_sock); WSACleanup(); return 1;
    }
    if (listen(listen_sock, SOMAXCONN) == SOCKET_ERROR) {
        printf("listen() failed: %d\n", WSAGetLastError());
        closesocket(listen_sock); WSACleanup(); return 1;
    }
    udp_sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (udp_sock == INVALID_SOCKET) {
        printf("UDP socket() failed: %d\n", WSAGetLastError());
        stop_server(); WSACleanup(); return 1;
    }
    struct sockaddr_in udp_addr = {0};
    udp_addr.sin_family = AF_INET;
    udp_addr.sin_addr.s_addr = htonl(INADDR_ANY);
    udp_addr.sin_port = htons(UDP_PORT);
    if (bind(udp_sock, (struct sockaddr *)&udp_addr, sizeof udp_addr) == SOCKET_ERROR) {
        printf("UDP bind() failed: %d (is port %d already in use?)\n", WSAGetLastError(), UDP_PORT);
        closesocket(udp_sock); closesocket(listen_sock); WSACleanup(); return 1;
    }
    HANDLE udp_thread = CreateThread(NULL, 0, udp_handler, NULL, 0, NULL);
    if (!udp_thread) {
        printf("Could not start UDP listener thread.\n");
        stop_server(); WSACleanup(); return 1;
    }
    slog("TCP reports listening on 0.0.0.0:%d; UDP alerts listening on 0.0.0.0:%d (max %d TCP clients). Press Ctrl+C to stop.",
         PORT, UDP_PORT, MAX_CLIENTS);

    while (running) {
        struct sockaddr_in ca; int cl = sizeof ca;
        SOCKET s = accept(listen_sock, (struct sockaddr *)&ca, &cl);
        if (s == INVALID_SOCKET) {
            if (!running) break;
            slog("accept() failed: %d", WSAGetLastError());
            Sleep(100);
            continue;
        }

        // find a free slot and claim it while holding the lock
        int slot = -1;
        EnterCriticalSection(&lock);
        for (int i = 0; i < MAX_CLIENTS; i++)
            if (!clients[i].active) { slot = i; break; }
        if (slot >= 0) {
            Client *c = &clients[slot];
            c->sock = s; c->id = next_id++; c->active = 1;
            InetNtopA(AF_INET, &ca.sin_addr, c->ip, sizeof c->ip);
        }
        LeaveCriticalSection(&lock);

        if (slot < 0) {
            slog("Server full, rejecting a connection");
            const char *m = "ERROR: Server full, try again later.\n";
            send_all(s, m, (int)strlen(m));
            closesocket(s);
            continue;
        }

        slog("New connection: Client #%d from %s; active TCP clients: %d/%d",
             clients[slot].id, clients[slot].ip, active_client_count(), MAX_CLIENTS);
        HANDLE h = CreateThread(NULL, 0, handler, &clients[slot], 0, NULL);
        if (!h) {                                         // thread failed: undo everything
            slog("CreateThread failed for Client #%d", clients[slot].id);
            closesocket(s);
            EnterCriticalSection(&lock);
            clients[slot].sock = INVALID_SOCKET; clients[slot].active = 0;
            LeaveCriticalSection(&lock);
            continue;
        }
        CloseHandle(h);                                   // we don't need the handle
    }

    // shutdown: stop accept, wake every client thread, wait for them
    stop_server();
    EnterCriticalSection(&lock);
    for (int i = 0; i < MAX_CLIENTS; i++)
        if (clients[i].active) shutdown(clients[i].sock, SD_BOTH);
    LeaveCriticalSection(&lock);

    for (int w = 0; w < 30; w++) {                        // wait up to ~3 seconds
        int left = 0;
        EnterCriticalSection(&lock);
        for (int i = 0; i < MAX_CLIENTS; i++) left += clients[i].active;
        LeaveCriticalSection(&lock);
        if (!left) break;
        Sleep(100);
    }
    WaitForSingleObject(udp_thread, 1000);
    CloseHandle(udp_thread);
    DeleteCriticalSection(&alerts_lock);
    DeleteCriticalSection(&reports_lock);
    DeleteCriticalSection(&lock);
    WSACleanup();
    slog("Server stopped.");
    DeleteCriticalSection(&log_lock);
    return 0;
}