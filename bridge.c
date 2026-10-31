#define _CRT_SECURE_NO_WARNINGS
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <stdint.h>
#include <ctype.h>

#ifdef _MSC_VER
#pragma comment(lib, "Ws2_32.lib")
#endif

#define HTTP_PORT 5000
#define C_PORT 9090
#define UDP_PORT 9091
#define C_HOST "127.0.0.1"
#define MAX_REQUEST 16384
#define MAX_BODY 8192
#define MAX_REPLY 131072
#define MAX_SESSIONS 256
#define MAX_INBOX 100
#define CLIENT_TTL 10
#define IDLE_SECONDS 300
#define SERVER_BIND_ADDRESS "0.0.0.0"

typedef struct Message {
    char sender[7];
    char *text;
    struct Message *next;
} Message;

typedef struct Session {
    char id[65];
    SOCKET tcp;
    time_t last_seen;
    time_t last_presence;
    CRITICAL_SECTION lock;
    Message *head, *tail;
    int inbox_count;
    struct Session *next;
} Session;

static Session *sessions = NULL;
static CRITICAL_SECTION sessions_lock;
static volatile LONG running = 1;

static void close_socket(SOCKET *s) {
    if (*s != INVALID_SOCKET) {
        shutdown(*s, SD_BOTH);
        closesocket(*s);
        *s = INVALID_SOCKET;
    }
}

static int send_all(SOCKET s, const char *buf, int len) {
    int sent = 0;

    while (sent < len) {
        int n = send(s, buf + sent, len - sent, 0);

        if (n <= 0)
            return 0;

        sent += n;
    }

    return 1;
}

static void http_response(
    SOCKET client,
    int status,
    const char *reason,
    const char *type,
    const char *body
) {
    char header[1024];
    int body_len = (int)strlen(body);

    int n = snprintf(
        header,
        sizeof(header),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %d\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        "Cache-Control: no-store\r\n"
        "Connection: close\r\n\r\n",
        status,
        reason,
        type,
        body_len
    );

    if (n > 0 && n < (int)sizeof(header)) {
        send_all(client, header, n);

        if (body_len)
            send_all(client, body, body_len);
    }
}

static void json_error(
    SOCKET client,
    int status,
    const char *reason,
    const char *message
) {
    char body[1024];

    snprintf(
        body,
        sizeof(body),
        "{\"ok\":false,\"error\":\"%s\"}",
        message
    );

    http_response(
        client,
        status,
        reason,
        "application/json; charset=utf-8",
        body
    );
}

static int valid_sid(const char *s) {
    size_t n;

    if (!s)
        return 0;

    n = strlen(s);

    if (n < 8 || n > 64)
        return 0;

    for (size_t i = 0; i < n; i++) {
        if (!(isalnum((unsigned char)s[i]) ||
              s[i] == '_' ||
              s[i] == '-')) {
            return 0;
        }
    }

    return 1;
}

static int json_get_string(
    const char *json,
    const char *key,
    char *out,
    size_t cap
) {
    char needle[128];
    const char *p;
    const char *end;
    size_t used = 0;

    snprintf(
        needle,
        sizeof(needle),
        "\"%s\"",
        key
    );

    p = strstr(json, needle);

    if (!p)
        return 0;

    p += strlen(needle);

    while (*p && isspace((unsigned char)*p))
        p++;

    if (*p++ != ':')
        return 0;

    while (*p && isspace((unsigned char)*p))
        p++;

    if (*p++ != '"')
        return 0;

    end = p;

    while (*end) {
        if (*end == '\\') {
            if (end[1])
                end += 2;
            else
                return 0;

            continue;
        }

        if (*end == '"')
            break;

        end++;
    }

    if (*end != '"')
        return 0;

    while (p < end && used + 1 < cap) {
        if (*p == '\\') {
            p++;

            if (p >= end)
                break;

            if (*p == 'n')
                out[used++] = '\n';
            else if (*p == 'r')
                out[used++] = '\r';
            else if (*p == 't')
                out[used++] = '\t';
            else if (*p == '"' ||
                     *p == '\\' ||
                     *p == '/') {
                out[used++] = *p;
            }
            else if (*p == 'u' && p + 4 < end) {
                unsigned int v = 0;

                for (int i = 1; i <= 4; i++) {
                    char c = p[i];

                    v <<= 4;

                    if (c >= '0' && c <= '9')
                        v |= (unsigned int)(c - '0');
                    else if (c >= 'a' && c <= 'f')
                        v |= (unsigned int)(c - 'a' + 10);
                    else if (c >= 'A' && c <= 'F')
                        v |= (unsigned int)(c - 'A' + 10);
                }

                out[used++] = v < 128 ? (char)v : '?';
                p += 4;
            }
            else {
                out[used++] = *p;
            }
        }
        else {
            out[used++] = *p;
        }

        p++;
    }

    if (p < end)
        return 0;

    out[used] = '\0';

    return 1;
}

static int json_get_integer(const char *json, const char *key, int *out) {
    char needle[128];
    snprintf(needle, sizeof(needle), "\"%s\"", key);
    const char *p = strstr(json, needle);
    if (!p) return 0;
    p += strlen(needle);
    while (*p && isspace((unsigned char)*p)) p++;
    if (*p++ != ':') return 0;
    while (*p && isspace((unsigned char)*p)) p++;
    char *end = NULL;
    long value = strtol(p, &end, 10);
    if (end == p || value < 0 || value > 1000000) return 0;
    while (*end && isspace((unsigned char)*end)) end++;
    if (*end && *end != ',' && *end != '}') return 0;
    *out = (int)value;
    return 1;
}

static char *json_escape(const char *s) {
    size_t cap = strlen(s) * 6 + 1;
    size_t j = 0;

    char *out = (char *)malloc(cap);

    if (!out)
        return NULL;

    for (size_t i = 0; s[i]; i++) {
        unsigned char c = (unsigned char)s[i];

        if (c == '"' || c == '\\') {
            out[j++] = '\\';
            out[j++] = (char)c;
        }
        else if (c == '\n') {
            out[j++] = '\\';
            out[j++] = 'n';
        }
        else if (c == '\r') {
            out[j++] = '\\';
            out[j++] = 'r';
        }
        else if (c == '\t') {
            out[j++] = '\\';
            out[j++] = 't';
        }
        else if (c < 32) {
            j += (size_t)sprintf(
                out + j,
                "\\u%04x",
                c
            );
        }
        else {
            out[j++] = (char)c;
        }
    }

    out[j] = '\0';

    return out;
}

static Session *find_session_locked(const char *sid) {
    for (Session *s = sessions; s; s = s->next) {
        if (strcmp(s->id, sid) == 0)
            return s;
    }

    return NULL;
}

static Session *get_session(const char *sid) {
    Session *s;

    EnterCriticalSection(&sessions_lock);

    s = find_session_locked(sid);

    if (!s && sessions) {
        int count = 0;

        for (Session *p = sessions; p; p = p->next)
            count++;

        if (count >= MAX_SESSIONS) {
            LeaveCriticalSection(&sessions_lock);
            return NULL;
        }
    }

    if (!s) {
        s = (Session *)calloc(1, sizeof(Session));

        if (s) {
            strncpy(
                s->id,
                sid,
                sizeof(s->id) - 1
            );

            s->tcp = INVALID_SOCKET;

            InitializeCriticalSection(&s->lock);

            s->next = sessions;
            sessions = s;
        }
    }

    if (s)
        s->last_seen = time(NULL);

    LeaveCriticalSection(&sessions_lock);

    return s;
}

static void touch_presence(Session *s) {
    s->last_presence = time(NULL);
}

static void free_messages(Message *m) {
    while (m) {
        Message *next = m->next;

        free(m->text);
        free(m);

        m = next;
    }
}

static void enqueue_message(
    Session *target,
    const char *sender,
    const char *text
) {
    Message *m = (Message *)calloc(1, sizeof(Message));

    if (!m)
        return;

    strncpy(m->sender, sender, 6);
    m->sender[6] = '\0';

    m->text = _strdup(text);

    if (!m->text) {
        free(m);
        return;
    }

    EnterCriticalSection(&target->lock);

    if (target->inbox_count >= MAX_INBOX &&
        target->head) {
        Message *old = target->head;

        target->head = old->next;

        if (!target->head)
            target->tail = NULL;

        free(old->text);
        free(old);

        target->inbox_count--;
    }

    if (target->tail)
        target->tail->next = m;
    else
        target->head = m;

    target->tail = m;
    target->inbox_count++;

    LeaveCriticalSection(&target->lock);
}

static int read_tcp_line(
    SOCKET s,
    char *out,
    size_t cap
) {
    size_t used = 0;
    int too_long = 0;

    for (;;) {
        char c;

        int n = recv(s, &c, 1, 0);

        if (n <= 0)
            return 0;

        if (c == '\n')
            break;

        if (c != '\r') {
            if (used + 1 < cap)
                out[used++] = c;
            else
                too_long = 1;
        }
    }

    out[used] = '\0';

    return !too_long;
}

static int tcp_exchange(
    Session *sess,
    const char *message,
    char *reply,
    size_t reply_cap,
    int *closed
) {
    int attempts = 0;

    *closed = 0;

    while (attempts++ < 2) {
        int fresh = (
            sess->tcp == INVALID_SOCKET
        );

        if (fresh) {
            struct sockaddr_in addr;

            sess->tcp = socket(
                AF_INET,
                SOCK_STREAM,
                IPPROTO_TCP
            );

            if (sess->tcp == INVALID_SOCKET)
                return -1;

            DWORD timeout = 3000;

            setsockopt(
                sess->tcp,
                SOL_SOCKET,
                SO_RCVTIMEO,
                (const char *)&timeout,
                sizeof(timeout)
            );

            setsockopt(
                sess->tcp,
                SOL_SOCKET,
                SO_SNDTIMEO,
                (const char *)&timeout,
                sizeof(timeout)
            );

            memset(&addr, 0, sizeof(addr));

            addr.sin_family = AF_INET;
            addr.sin_port = htons(C_PORT);

            inet_pton(
                AF_INET,
                C_HOST,
                &addr.sin_addr
            );

            if (connect(
                sess->tcp,
                (struct sockaddr *)&addr,
                sizeof(addr)
            ) == SOCKET_ERROR) {
                close_socket(&sess->tcp);
                return -1;
            }
        }

        char *line = (char *)malloc(
            strlen(message) + 2
        );

        if (!line)
            return -1;

        sprintf(line, "%s\n", message);

        int ok = send_all(
            sess->tcp,
            line,
            (int)strlen(line)
        );

        free(line);

        if (ok && read_tcp_line(
            sess->tcp,
            reply,
            reply_cap
        )) {
            if (strncmp(reply, "Goodbye!", 8) == 0 ||
                strncmp(
                    reply,
                    "ERROR: Server full",
                    18
                ) == 0) {
                *closed = 1;
                close_socket(&sess->tcp);
            }

            return 1;
        }

        close_socket(&sess->tcp);

        if (fresh)
            return -1;
    }

    return 0;
}

static int send_udp_alert(const char *severity, const char *traffic,
                          const char *immediate_danger,
                          const char *road, const char *locality) {
    SOCKET sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock == INVALID_SOCKET)
        return 0;

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(UDP_PORT);
    inet_pton(AF_INET, C_HOST, &addr.sin_addr);

    char message[512];
    int len = snprintf(message, sizeof(message), "ALERT_V2|%s|%s|%s|%s|%s",
                       severity, traffic, immediate_danger, road, locality);
    int ok = len > 0 && len < (int)sizeof(message) &&
        sendto(sock, message, len, 0,
               (struct sockaddr *)&addr, sizeof(addr)) != SOCKET_ERROR;
    closesocket(sock);
    return ok;
}
static int send_udp_alert_status(const char *id, const char *status,
                                 char *response, size_t response_capacity,
                                 int *error_code) {
    SOCKET sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock == INVALID_SOCKET) {
        if (error_code) *error_code = WSAGetLastError();
        return 0;
    }

    DWORD timeout_ms = 3000;
    if (setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO,
                   (const char *)&timeout_ms, sizeof(timeout_ms)) == SOCKET_ERROR) {
        if (error_code) *error_code = WSAGetLastError();
        closesocket(sock);
        return 0;
    }

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(UDP_PORT);
    inet_pton(AF_INET, C_HOST, &addr.sin_addr);

    char message[256];
    int len = snprintf(message, sizeof(message), "ALERT_STATUS|%s|%s", id, status);
    if (len <= 0 || len >= (int)sizeof(message) ||
        sendto(sock, message, len, 0,
               (struct sockaddr *)&addr, sizeof(addr)) == SOCKET_ERROR) {
        if (error_code) *error_code = WSAGetLastError();
        closesocket(sock);
        return 0;
    }

    struct sockaddr_in sender;
    int sender_len = sizeof(sender);
    int received = recvfrom(sock, response, (int)response_capacity - 1, 0,
                            (struct sockaddr *)&sender, &sender_len);
    if (received == SOCKET_ERROR) {
        int err = WSAGetLastError();
        if (error_code) *error_code = err;
        closesocket(sock);
        return (err == WSAETIMEDOUT) ? 2 : 0;
    }

    response[received] = '\0';
    closesocket(sock);
    return 1;
}

static int valid_report_value(const char *value, size_t max_len) {
    size_t len = strlen(value);
    if (!len || len > max_len)
        return 0;
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)value[i];
        if (c < 32 || c == '|')
            return 0;
    }
    return 1;
}

static int valid_optional_report_value(const char *value, size_t max_len) {
    size_t len = strlen(value);
    if (len > max_len)
        return 0;
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)value[i];
        if (c < 32 || c == '|')
            return 0;
    }
    return 1;
}

static void serve_file(
    SOCKET client,
    const char *url_path
) {
    char path[MAX_PATH * 2];

    const char *name = url_path;

    if (!strcmp(name, "/"))
        name = "/index.html";

    while (*name == '/')
        name++;

    if (!*name)
        name = "index.html";

    if (strstr(name, "..") ||
        strchr(name, ':') ||
        strchr(name, '\\')) {
        json_error(
            client,
            400,
            "Bad Request",
            "Invalid path"
        );

        return;
    }

    snprintf(
        path,
        sizeof(path),
        "web\\%s",
        name
    );

    FILE *f = fopen(path, "rb");

    if (!f) {
        http_response(
            client,
            404,
            "Not Found",
            "text/plain; charset=utf-8",
            "Not found"
        );

        return;
    }

    fseek(f, 0, SEEK_END);

    long len = ftell(f);

    rewind(f);

    if (len < 0 || len > 20 * 1024 * 1024) {
        fclose(f);

        http_response(
            client,
            413,
            "Payload Too Large",
            "text/plain",
            "File too large"
        );

        return;
    }

    char *data = (char *)malloc(
        (size_t)len + 1
    );

    if (!data) {
        fclose(f);

        http_response(
            client,
            500,
            "Internal Server Error",
            "text/plain",
            "Out of memory"
        );

        return;
    }

    size_t got = fread(
        data,
        1,
        (size_t)len,
        f
    );

    fclose(f);

    data[got] = '\0';

    const char *dot = strrchr(name, '.');

    const char *type = "application/octet-stream";

    if (dot) {
        if (!_stricmp(dot, ".html"))
            type = "text/html; charset=utf-8";
        else if (!_stricmp(dot, ".css"))
            type = "text/css; charset=utf-8";
        else if (!_stricmp(dot, ".js"))
            type = "application/javascript; charset=utf-8";
        else if (!_stricmp(dot, ".svg"))
            type = "image/svg+xml";
        else if (!_stricmp(dot, ".png"))
            type = "image/png";
        else if (!_stricmp(dot, ".jpg") ||
                 !_stricmp(dot, ".jpeg"))
            type = "image/jpeg";
        else if (!_stricmp(dot, ".ico"))
            type = "image/x-icon";
    }

    char header[1024];

    int h = snprintf(
        header,
        sizeof(header),
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %lu\r\n"
        "Cache-Control: no-store\r\n"
        "Connection: close\r\n\r\n",
        type,
        (unsigned long)got
    );

    if (h > 0 && h < (int)sizeof(header)) {
        send_all(client, header, h);

        if (got)
            send_all(client, data, (int)got);
    }

    free(data);
}

static void handle_request(
    SOCKET client,
    char *req
) {
    char method[16] = {0};
    char path[2048] = {0};

    char *body = strstr(req, "\r\n\r\n");

    if (!body) {
        json_error(
            client,
            400,
            "Bad Request",
            "Malformed HTTP request"
        );

        return;
    }

    *body = '\0';
    body += 4;

    sscanf(
        req,
        "%15s %2047s",
        method,
        path
    );

    if (!strcmp(method, "OPTIONS")) {
        http_response(
            client,
            204,
            "No Content",
            "application/json",
            ""
        );

        return;
    }

    if (!strcmp(method, "GET") &&
        !strcmp(path, "/api/health")) {
        SOCKET test = socket(
            AF_INET,
            SOCK_STREAM,
            IPPROTO_TCP
        );

        int online = 0;

        if (test != INVALID_SOCKET) {
            struct sockaddr_in addr;

            memset(&addr, 0, sizeof(addr));

            addr.sin_family = AF_INET;
            addr.sin_port = htons(C_PORT);

            inet_pton(
                AF_INET,
                C_HOST,
                &addr.sin_addr
            );

            DWORD timeout = 1500;

            setsockopt(
                test,
                SOL_SOCKET,
                SO_RCVTIMEO,
                (const char *)&timeout,
                sizeof(timeout)
            );

            if (connect(
                test,
                (struct sockaddr *)&addr,
                sizeof(addr)
            ) != SOCKET_ERROR) {
                online = 1;
            }

            closesocket(test);
        }

        char response[128];

        snprintf(
            response,
            sizeof(response),
            "{\"bridge\":\"ok\",\"backend\":\"%s\"}",
            online ? "online" : "offline"
        );

        http_response(
            client,
            200,
            "OK",
            "application/json; charset=utf-8",
            response
        );

        return;
    }

    if (!strcmp(method, "GET")) {
        char *q = strchr(path, '?');

        if (q)
            *q = '\0';

        serve_file(client, path);

        return;
    }

    if (strcmp(method, "POST")) {
        json_error(
            client,
            405,
            "Method Not Allowed",
            "Method not allowed"
        );

        return;
    }

    char sid[128] = {0};
    char msg[MAX_BODY + 1] = {0};
    char recipient[128] = "all";

    if (!json_get_string(
        body,
        "session",
        sid,
        sizeof(sid)
    ) || !valid_sid(sid)) {
        json_error(
            client,
            400,
            "Bad Request",
            "Invalid session id"
        );

        return;
    }

    Session *sess = get_session(sid);

    if (!sess) {
        json_error(
            client,
            503,
            "Service Unavailable",
            "Session limit reached"
        );

        return;
    }

    touch_presence(sess);

    if (!strcmp(path, "/api/tcp-test") ||
        !strcmp(path, "/api/network-info")) {
        int is_tcp_test = !strcmp(path, "/api/tcp-test");
        const char *command = is_tcp_test ? "PING" : "STATS";
        char reply[MAX_REPLY] = {0};
        int closed = 0;
        EnterCriticalSection(&sess->lock);
        int result = tcp_exchange(sess, command, reply, sizeof(reply), &closed);
        LeaveCriticalSection(&sess->lock);
        if (result <= 0) {
            json_error(client, result == 0 ? 504 : 502,
                       result == 0 ? "Gateway Timeout" : "Bad Gateway",
                       result == 0 ? "The C server did not reply in time" :
                           "Cannot reach the C TCP server. Is server.exe running?");
            return;
        }
        if (is_tcp_test) {
            http_response(client, 200, "OK", "application/json; charset=utf-8", reply);
            return;
        }

        int active_clients, max_clients, tcp_port, udp_port;
        char bind_address[64] = {0};
        if (!json_get_integer(reply, "activeClients", &active_clients) ||
            !json_get_integer(reply, "maxClients", &max_clients) ||
            !json_get_integer(reply, "tcpPort", &tcp_port) ||
            !json_get_integer(reply, "udpPort", &udp_port) ||
            !json_get_string(reply, "serverBindAddress", bind_address,
                             sizeof(bind_address))) {
            json_error(client, 502, "Bad Gateway",
                       "The C server returned invalid network information");
            return;
        }
        char response[512];
        snprintf(response, sizeof(response),
                 "{\"ok\":true,\"serverBindAddress\":\"%s\","
                 "\"bridgeHost\":\"%s\",\"backendTarget\":\"%s\","
                 "\"httpPort\":%d,\"tcpPort\":%d,\"udpPort\":%d,"
                 "\"activeClients\":%d,\"maxClients\":%d}",
                 bind_address, C_HOST, C_HOST, HTTP_PORT, tcp_port, udp_port,
                 active_clients, max_clients);
        http_response(client, 200, "OK", "application/json; charset=utf-8", response);
        return;
    }

    if (!strcmp(path, "/api/report")) {
        char road[256] = {0};
        char locality[256] = {0};
        char latitude[64] = {0};
        char longitude[64] = {0};
        char severity[32] = {0};
        char traffic[32] = {0};
        char immediate_danger[16] = {0};
        char description[512] = {0};
        char command[1024];

        if (!json_get_string(body, "road", road, sizeof(road)) ||
            !json_get_string(body, "locality", locality, sizeof(locality)) ||
            !json_get_string(body, "latitude", latitude, sizeof(latitude)) ||
            !json_get_string(body, "longitude", longitude, sizeof(longitude)) ||
            !json_get_string(body, "severity", severity, sizeof(severity)) ||
            !json_get_string(body, "traffic", traffic, sizeof(traffic)) ||
            !json_get_string(body, "immediateDanger", immediate_danger,
                             sizeof(immediate_danger)) ||
            !json_get_string(body, "description", description, sizeof(description)) ||
            !valid_report_value(road, 120) ||
            !valid_report_value(locality, 120) ||
            !valid_optional_report_value(latitude, 32) ||
            !valid_optional_report_value(longitude, 32) ||
            (!!latitude[0] != !!longitude[0]) ||
            !valid_report_value(severity, 15) ||
            !valid_report_value(traffic, 15) ||
            (_stricmp(immediate_danger, "Yes") &&
             _stricmp(immediate_danger, "No")) ||
            !valid_report_value(description, 280)) {
            json_error(client, 400, "Bad Request", "Check the report fields and length limits");
            return;
        }

        int command_len = snprintf(command, sizeof(command),
                                   "REPORT|%s|%s|%s|%s|%s|%s|%s|%s",
                                   severity, traffic, road, locality, latitude,
                                   longitude, description, immediate_danger);
        if (command_len < 0 || command_len >= (int)sizeof(command)) {
            json_error(client, 413, "Payload Too Large", "Report is too large");
            return;
        }

        char reply[MAX_REPLY] = {0};
        int closed = 0;
        EnterCriticalSection(&sess->lock);
        int result = tcp_exchange(sess, command, reply, sizeof(reply), &closed);
        LeaveCriticalSection(&sess->lock);

        if (result <= 0) {
            json_error(client, result == 0 ? 504 : 502,
                       result == 0 ? "Gateway Timeout" : "Bad Gateway",
                       result == 0 ? "The C server did not reply in time" :
                           "Cannot reach the C TCP server. Is server.exe running?");
            return;
        }
        http_response(client, 200, "OK", "application/json; charset=utf-8", reply);
        return;
    }

    if (!strcmp(path, "/api/report-detail")) {
        char id[32] = {0};
        char command[64];
        if (!json_get_string(body, "id", id, sizeof(id)) ||
            !valid_report_value(id, 19)) {
            json_error(client, 400, "Bad Request", "Invalid report ID");
            return;
        }
        snprintf(command, sizeof(command), "DETAIL|%s", id);
        char reply[MAX_REPLY] = {0};
        int closed = 0;
        EnterCriticalSection(&sess->lock);
        int result = tcp_exchange(sess, command, reply, sizeof(reply), &closed);
        LeaveCriticalSection(&sess->lock);
        if (result <= 0) {
            json_error(client, result == 0 ? 504 : 502,
                       result == 0 ? "Gateway Timeout" : "Bad Gateway",
                       result == 0 ? "The C server did not reply in time" :
                           "Cannot reach the C TCP server. Is server.exe running?");
            return;
        }
        http_response(client, 200, "OK", "application/json; charset=utf-8", reply);
        return;
    }

    if (!strcmp(path, "/api/report-status")) {
        char id[32] = {0};
        char status[32] = {0};
        char command[96];
        if (!json_get_string(body, "id", id, sizeof(id)) ||
            !json_get_string(body, "status", status, sizeof(status)) ||
            !valid_report_value(id, 19) ||
            !valid_report_value(status, 20)) {
            json_error(client, 400, "Bad Request", "Status update fields are invalid");
            return;
        }
        snprintf(command, sizeof(command), "STATUS|%s|%s", id, status);
        char reply[MAX_REPLY] = {0};
        int closed = 0;
        EnterCriticalSection(&sess->lock);
        int result = tcp_exchange(sess, command, reply, sizeof(reply), &closed);
        LeaveCriticalSection(&sess->lock);
        if (result <= 0) {
            json_error(client, result == 0 ? 504 : 502,
                       result == 0 ? "Gateway Timeout" : "Bad Gateway",
                       result == 0 ? "The C server did not reply in time" :
                           "Cannot reach the C TCP server. Is server.exe running?");
            return;
        }
        http_response(client, 200, "OK", "application/json; charset=utf-8", reply);
        return;
    }

    if (!strcmp(path, "/api/reports")) {
        char reply[MAX_REPLY] = {0};
        int closed = 0;
        EnterCriticalSection(&sess->lock);
        int result = tcp_exchange(sess, "LIST", reply, sizeof(reply), &closed);
        LeaveCriticalSection(&sess->lock);

        if (result <= 0) {
            json_error(client, result == 0 ? 504 : 502,
                       result == 0 ? "Gateway Timeout" : "Bad Gateway",
                       result == 0 ? "The C server did not reply in time" :
                           "Cannot reach the C TCP server. Is server.exe running?");
            return;
        }
        http_response(client, 200, "OK", "application/json; charset=utf-8", reply);
        return;
    }

    if (!strcmp(path, "/api/duplicate-check")) {
        char road[256] = {0};
        char locality[256] = {0};
        char command[520];
        if (!json_get_string(body, "road", road, sizeof(road)) ||
            !json_get_string(body, "locality", locality, sizeof(locality)) ||
            !valid_report_value(road, 120) ||
            !valid_report_value(locality, 120)) {
            json_error(client, 400, "Bad Request", "Road and locality are required");
            return;
        }
        snprintf(command, sizeof(command), "CHECK|%s|%s", road, locality);
        char reply[MAX_REPLY] = {0};
        int closed = 0;
        EnterCriticalSection(&sess->lock);
        int result = tcp_exchange(sess, command, reply, sizeof(reply), &closed);
        LeaveCriticalSection(&sess->lock);
        if (result <= 0) {
            json_error(client, result == 0 ? 504 : 502,
                       result == 0 ? "Gateway Timeout" : "Bad Gateway",
                       result == 0 ? "The C server did not reply in time" :
                           "Cannot reach the C TCP server. Is server.exe running?");
            return;
        }
        http_response(client, 200, "OK", "application/json; charset=utf-8", reply);
        return;
    }

    if (!strcmp(path, "/api/udp-alerts")) {
        char reply[MAX_REPLY] = {0};
        int closed = 0;
        EnterCriticalSection(&sess->lock);
        int result = tcp_exchange(sess, "ALERTS", reply, sizeof(reply), &closed);
        LeaveCriticalSection(&sess->lock);
        if (result <= 0) {
            json_error(client, result == 0 ? 504 : 502,
                       result == 0 ? "Gateway Timeout" : "Bad Gateway",
                       result == 0 ? "The C server did not reply in time" :
                           "Cannot reach the C TCP server. Is server.exe running?");
            return;
        }
        http_response(client, 200, "OK", "application/json; charset=utf-8", reply);
        return;
    }

    if (!strcmp(path, "/api/udp-alert")) {
        char road[256] = {0};
        char locality[256] = {0};
        char severity[32] = {0};
        char traffic[32] = {0};
        char immediate_danger[16] = {0};
        if (!json_get_string(body, "road", road, sizeof(road)) ||
            !json_get_string(body, "locality", locality, sizeof(locality)) ||
            !json_get_string(body, "severity", severity, sizeof(severity)) ||
            !json_get_string(body, "traffic", traffic, sizeof(traffic)) ||
            !json_get_string(body, "immediateDanger", immediate_danger,
                             sizeof(immediate_danger)) ||
            !valid_report_value(road, 120) ||
            !valid_report_value(locality, 120) ||
            (!valid_report_value(severity, 15)) ||
            (_stricmp(severity, "Low") && _stricmp(severity, "Medium") &&
             _stricmp(severity, "High")) ||
            (_stricmp(traffic, "Low") && _stricmp(traffic, "Medium") &&
             _stricmp(traffic, "High")) ||
            (_stricmp(immediate_danger, "Yes") &&
             _stricmp(immediate_danger, "No"))) {
            json_error(client, 400, "Bad Request",
                       "Enter valid road, locality, severity, traffic, and danger values");
            return;
        }
        if (!send_udp_alert(severity, traffic, immediate_danger, road, locality)) {
            json_error(client, 502, "Bad Gateway", "Winsock could not send the UDP datagram");
            return;
        }
        http_response(client, 200, "OK", "application/json; charset=utf-8",
                      "{\"ok\":true,\"sent\":true,\"deliveryGuaranteed\":false,\"confirmed\":false}");
        return;
    }

    if (!strcmp(path, "/api/udp-status") || !strcmp(path, "/api/udp-alert-status")) {
        char id[32] = {0};
        char status[32] = {0};
        if (!json_get_string(body, "id", id, sizeof(id)) ||
            !json_get_string(body, "status", status, sizeof(status)) ||
            !valid_report_value(id, 19) ||
            !valid_report_value(status, 20) ||
            (_stricmp(status, "Pending") && _stricmp(status, "Under Review") &&
             _stricmp(status, "In Progress") && _stricmp(status, "Resolved"))) {
            json_error(client, 400, "Bad Request", "Invalid alert ID or status value");
            return;
        }

        char udp_response[512] = {0};
        int error_code = 0;
        int res = send_udp_alert_status(id, status, udp_response, sizeof(udp_response), &error_code);
        if (res == 1) {
            char ack_id[32] = {0}, ack_status[32] = {0};
            if (sscanf(udp_response, "ACK|STATUS|%31[^|]|%31[^|]", ack_id, ack_status) == 2) {
                char json[256];
                snprintf(json, sizeof(json),
                         "{\"ok\":true,\"id\":\"%s\",\"status\":\"%s\",\"confirmed\":true}",
                         ack_id, ack_status);
                http_response(client, 200, "OK", "application/json; charset=utf-8", json);
                return;
            } else if (!strncmp(udp_response, "NACK|", 5)) {
                json_error(client, 404, "Not Found", udp_response + 5);
                return;
            } else {
                json_error(client, 500, "Internal Server Error", "Unexpected UDP server response");
                return;
            }
        } else if (res == 2) {
            json_error(client, 504, "Gateway Timeout",
                       "No UDP status acknowledgement received within 3 seconds; delivery is unconfirmed");
            return;
        } else {
            json_error(client, 502, "Bad Gateway", "Winsock could not complete the UDP status operation");
            return;
        }
    }

    if (!strcmp(path, "/api/clients")) {
        char response[32768];

        size_t used = (size_t)snprintf(
            response,
            sizeof(response),
            "{\"ok\":true,\"clients\":["
        );

        int online = 1;
        time_t now = time(NULL);

        EnterCriticalSection(&sessions_lock);

        for (Session *p = sessions; p; p = p->next) {
            if (p == sess ||
                now - p->last_presence > CLIENT_TTL) {
                continue;
            }

            char label[64];

            snprintf(
                label,
                sizeof(label),
                "Client %.6s",
                p->id
            );

            char *ei = json_escape(p->id);
            char *el = json_escape(label);

            if (!ei || !el) {
                free(ei);
                free(el);
                continue;
            }

            if (used + strlen(ei) +
                strlen(el) + 80 < sizeof(response)) {
                used += (size_t)snprintf(
                    response + used,
                    sizeof(response) - used,
                    "%s{\"id\":\"%s\",\"label\":\"%s\"}",
                    online > 1 ? "," : "",
                    ei,
                    el
                );

                online++;
            }

            free(ei);
            free(el);
        }

        LeaveCriticalSection(&sessions_lock);

        snprintf(
            response + used,
            sizeof(response) - used,
            "],\"online\":%d}",
            online
        );

        http_response(
            client,
            200,
            "OK",
            "application/json; charset=utf-8",
            response
        );

        return;
    }

    if (!strcmp(path, "/api/inbox")) {
        char response[32768];

        size_t used = (size_t)snprintf(
            response,
            sizeof(response),
            "{\"ok\":true,\"messages\":["
        );

        int first = 1;

        EnterCriticalSection(&sess->lock);

        Message *m = sess->head;

        sess->head = NULL;
        sess->tail = NULL;
        sess->inbox_count = 0;

        LeaveCriticalSection(&sess->lock);

        while (m) {
            Message *next = m->next;

            char *escaped = json_escape(m->text);

            if (escaped &&
                used + strlen(escaped) + 100 < sizeof(response)) {
                used += (size_t)snprintf(
                    response + used,
                    sizeof(response) - used,
                    "%s{\"sender\":\"%s\",\"message\":\"%s\"}",
                    first ? "" : ",",
                    m->sender,
                    escaped
                );

                first = 0;
            }

            free(escaped);
            free(m->text);
            free(m);

            m = next;
        }

        snprintf(
            response + used,
            sizeof(response) - used,
            "]}"
        );

        http_response(
            client,
            200,
            "OK",
            "application/json; charset=utf-8",
            response
        );

        return;
    }

    if (!strcmp(path, "/api/disconnect")) {
        EnterCriticalSection(&sess->lock);

        close_socket(&sess->tcp);

        LeaveCriticalSection(&sess->lock);

        EnterCriticalSection(&sessions_lock);

        sess->last_presence = 0;

        LeaveCriticalSection(&sessions_lock);

        http_response(
            client,
            200,
            "OK",
            "application/json; charset=utf-8",
            "{\"ok\":true}"
        );

        return;
    }

    if (!strcmp(path, "/api/send")) {
        if (!json_get_string(
            body,
            "message",
            msg,
            sizeof(msg)
        )) {
            json_error(
                client,
                400,
                "Bad Request",
                "Message must be text"
            );

            return;
        }

        if (strlen(msg) > 4096) {
            json_error(
                client,
                413,
                "Payload Too Large",
                "Message too large (bridge limit 4096 bytes)"
            );

            return;
        }

        for (size_t i = 0; msg[i]; i++) {
            if ((unsigned char)msg[i] < 32 &&
                msg[i] != '\t') {
                json_error(
                    client,
                    400,
                    "Bad Request",
                    "Message cannot contain line breaks or control characters"
                );

                return;
            }
        }

        if (json_get_string(
            body,
            "recipient",
            recipient,
            sizeof(recipient)
        )) {
            if (strcmp(recipient, "all") &&
                !valid_sid(recipient)) {
                json_error(
                    client,
                    400,
                    "Bad Request",
                    "Invalid recipient"
                );

                return;
            }
        }

        if (strcmp(recipient, "all")) {
            int found = 0;

            EnterCriticalSection(&sessions_lock);

            for (Session *p = sessions; p; p = p->next) {
                if (!strcmp(p->id, recipient) &&
                    time(NULL) - p->last_presence <= CLIENT_TTL) {
                    found = 1;
                    break;
                }
            }

            LeaveCriticalSection(&sessions_lock);

            if (!found) {
                json_error(
                    client,
                    409,
                    "Conflict",
                    "That client is no longer online. Choose another recipient."
                );

                return;
            }
        }

        char reply[MAX_REPLY] = {0};
        int closed = 0;

        EnterCriticalSection(&sess->lock);

        int result = tcp_exchange(
            sess,
            msg,
            reply,
            sizeof(reply),
            &closed
        );

        LeaveCriticalSection(&sess->lock);

        if (result == 0) {
            json_error(
                client,
                504,
                "Gateway Timeout",
                "The C server did not reply in time"
            );

            return;
        }

        if (result < 0) {
            json_error(
                client,
                502,
                "Bad Gateway",
                "Cannot reach the C server. Is server.exe running?"
            );

            return;
        }

        int delivered = 0;

        if (!closed &&
            strncmp(reply, "ERROR:", 6) != 0) {
            time_t now = time(NULL);

            EnterCriticalSection(&sessions_lock);

            for (Session *p = sessions; p; p = p->next) {
                if (p == sess ||
                    now - p->last_presence > CLIENT_TTL) {
                    continue;
                }

                if (strcmp(recipient, "all") &&
                    strcmp(recipient, p->id)) {
                    continue;
                }

                enqueue_message(
                    p,
                    sid,
                    msg
                );

                delivered++;
            }

            LeaveCriticalSection(&sessions_lock);
        }

        char *er = json_escape(reply);

        if (!er) {
            json_error(
                client,
                500,
                "Internal Server Error",
                "Out of memory"
            );

            return;
        }

        size_t cap = strlen(er) + 256;

        char *response = (char *)malloc(cap);

        if (!response) {
            free(er);

            json_error(
                client,
                500,
                "Internal Server Error",
                "Out of memory"
            );

            return;
        }

        snprintf(
            response,
            cap,
            "{\"ok\":true,\"reply\":\"%s\",\"is_error\":%s,\"closed\":%s,\"delivered\":%d}",
            er,
            strncmp(reply, "ERROR:", 6) == 0 ? "true" : "false",
            closed ? "true" : "false",
            delivered
        );

        http_response(
            client,
            200,
            "OK",
            "application/json; charset=utf-8",
            response
        );

        free(er);
        free(response);

        return;
    }

    json_error(
        client,
        404,
        "Not Found",
        "Unknown API endpoint"
    );
}

static DWORD WINAPI client_thread(LPVOID param) {
    SOCKET client = (SOCKET)(uintptr_t)param;

    char *request = (char *)calloc(
        1,
        MAX_REQUEST + 1
    );

    if (request) {
        int total = 0;
        int header_end = 0;
        int content_length = 0;

        while (total < MAX_REQUEST) {
            int n = recv(
                client,
                request + total,
                MAX_REQUEST - total,
                0
            );

            if (n <= 0)
                break;

            total += n;
            request[total] = '\0';

            char *end = strstr(
                request,
                "\r\n\r\n"
            );

            if (end && !header_end) {
                header_end = (int)(
                    end + 4 - request
                );

                char *cl =
                    _strnicmp(
                        request,
                        "Content-Length:",
                        15
                    ) == 0
                    ? request + 15
                    : NULL;

                if (!cl) {
                    char *p = request;

                    while ((p = strstr(p, "\r\n")) != NULL) {
                        p += 2;

                        if (_strnicmp(
                            p,
                            "Content-Length:",
                            15
                        ) == 0) {
                            cl = p + 15;
                            break;
                        }

                        if (p[0] == '\r' &&
                            p[1] == '\n') {
                            break;
                        }
                    }
                }

                if (cl)
                    content_length = atoi(cl);

                if (content_length < 0 ||
                    content_length > MAX_BODY) {
                    break;
                }
            }

            if (header_end &&
                total >= header_end + content_length) {
                break;
            }

            if (!header_end &&
                total >= MAX_REQUEST) {
                break;
            }
        }

        if (total > 0) {
            if (!strstr(request, "\r\n\r\n")) {
                json_error(
                    client,
                    400,
                    "Bad Request",
                    "Malformed HTTP request"
                );
            }
            else {
                handle_request(client, request);
            }
        }

        free(request);
    }

    shutdown(client, SD_BOTH);
    closesocket(client);

    return 0;
}

static DWORD WINAPI reaper_thread(LPVOID unused) {
    (void)unused;

    while (InterlockedCompareExchange(
        &running,
        1,
        1
    )) {
        Sleep(30000);

        time_t now = time(NULL);

        EnterCriticalSection(&sessions_lock);

        Session **link = &sessions;

        while (*link) {
            Session *s = *link;

            if (now - s->last_seen > IDLE_SECONDS &&
                TryEnterCriticalSection(&s->lock)) {
                *link = s->next;

                close_socket(&s->tcp);

                free_messages(s->head);

                LeaveCriticalSection(&s->lock);

                DeleteCriticalSection(&s->lock);

                free(s);
            }
            else {
                link = &s->next;
            }
        }

        LeaveCriticalSection(&sessions_lock);
    }

    return 0;
}

int main(void) {
    WSADATA wsa;
    SOCKET listener;
    struct sockaddr_in addr;

    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        fprintf(stderr, "WSAStartup failed.\n");
        return 1;
    }

    InitializeCriticalSection(&sessions_lock);

    listener = socket(
        AF_INET,
        SOCK_STREAM,
        IPPROTO_TCP
    );

    if (listener == INVALID_SOCKET) {
        fprintf(
            stderr,
            "socket failed: %d\n",
            WSAGetLastError()
        );

        DeleteCriticalSection(&sessions_lock);
        WSACleanup();

        return 1;
    }

    memset(&addr, 0, sizeof(addr));

    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons(HTTP_PORT);

    if (bind(
        listener,
        (struct sockaddr *)&addr,
        sizeof(addr)
    ) == SOCKET_ERROR) {
        fprintf(
            stderr,
            "bind failed: %d. Is another app using port %d?\n",
            WSAGetLastError(),
            HTTP_PORT
        );

        closesocket(listener);
        DeleteCriticalSection(&sessions_lock);
        WSACleanup();

        return 1;
    }

    if (listen(
        listener,
        SOMAXCONN
    ) == SOCKET_ERROR) {
        fprintf(
            stderr,
            "listen failed: %d\n",
            WSAGetLastError()
        );

        closesocket(listener);
        DeleteCriticalSection(&sessions_lock);
        WSACleanup();

        return 1;
    }

    CreateThread(
        NULL,
        0,
        reaper_thread,
        NULL,
        0,
        NULL
    );

    printf(
        "NetLink C bridge: http://127.0.0.1:%d -> C TCP server %s:%d\n",
        HTTP_PORT,
        C_HOST,
        C_PORT
    );

    printf(
        "Place index.html, style.css and script.js in the .\\web folder.\n"
    );

    for (;;) {
        SOCKET client = accept(
            listener,
            NULL,
            NULL
        );

        if (client == INVALID_SOCKET) {
            fprintf(
                stderr,
                "accept failed: %d\n",
                WSAGetLastError()
            );

            continue;
        }

        DWORD tid;

        HANDLE th = CreateThread(
            NULL,
            0,
            client_thread,
            (LPVOID)(uintptr_t)client,
            0,
            &tid
        );

        if (th)
            CloseHandle(th);
        else
            closesocket(client);
    }

    closesocket(listener);

    DeleteCriticalSection(&sessions_lock);

    WSACleanup();

    return 0;
}