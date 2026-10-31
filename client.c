#define _CRT_SECURE_NO_WARNINGS
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <ctype.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>

#ifdef _MSC_VER
#pragma comment(lib, "Ws2_32.lib")
#endif

#define TCP_PORT "9090"
#define UDP_PORT 9091
#define MAX_LINE 1024

static int send_all(SOCKET sock, const char *data, int length) {
    int sent = 0;
    while (sent < length) {
        int n = send(sock, data + sent, length - sent, 0);
        if (n <= 0) return 0;
        sent += n;
    }
    return 1;
}

static int recv_line(SOCKET sock, char *out, int capacity) {
    int used = 0;
    while (used + 1 < capacity) {
        char ch;
        int n = recv(sock, &ch, 1, 0);
        if (n <= 0) return 0;
        if (ch == '\n') {
            out[used] = '\0';
            return 1;
        }
        if (ch != '\r') out[used++] = ch;
    }
    out[used] = '\0';
    return 0;
}

static int print_report_list(const char *response) {
    const char *cursor = strstr(response, "\"reports\"");
    int report_number = 0;
    if (!cursor) return 0;
    cursor += strlen("\"reports\"");
    while (isspace((unsigned char)*cursor)) cursor++;
    if (*cursor++ != ':') return 0;
    while (isspace((unsigned char)*cursor)) cursor++;
    if (*cursor++ != '[') return 0;

    printf("TCP server report list:\n");
    while (1) {
        while (isspace((unsigned char)*cursor)) cursor++;
        if (*cursor == ']') {
            if (!report_number) printf("  No reports found.\n");
            return 1;
        }
        if (*cursor != '{') return 0;

        const char *start = cursor;
        int depth = 0, in_string = 0, escaped = 0;
        do {
            char ch = *cursor++;
            if (!ch) return 0;
            if (in_string) {
                if (escaped) escaped = 0;
                else if (ch == '\\') escaped = 1;
                else if (ch == '"') in_string = 0;
            } else if (ch == '"') {
                in_string = 1;
            } else if (ch == '{') {
                depth++;
            } else if (ch == '}') {
                depth--;
            }
        } while (depth > 0);

        size_t report_length = (size_t)(cursor - start);
        static const char resolved_status[] = "\"status\":\"Resolved\"";
        int is_resolved = 0;
        for (size_t i = 0; i + sizeof(resolved_status) - 1 <= report_length; i++) {
            if (!memcmp(start + i, resolved_status, sizeof(resolved_status) - 1)) {
                is_resolved = 1;
                break;
            }
        }
        if (!is_resolved)
            printf("  %d. %.*s\n", ++report_number, (int)report_length, start);
        while (isspace((unsigned char)*cursor)) cursor++;
        if (*cursor == ',') {
            cursor++;
        } else if (*cursor != ']') {
            return 0;
        }
    }
}

static void print_json_response(const char *title, const char *response) {
    int depth = 0, in_string = 0, escaped = 0;
    const char *cursor = response;

    printf("%s:\n", title);
    while (*cursor) {
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
                for (int i = 0; i < depth * 2; i++) putchar(' ');
            }
        } else if (ch == '}' || ch == ']') {
            depth--;
            putchar('\n');
            for (int i = 0; i < depth * 2; i++) putchar(' ');
            putchar(ch);
        } else if (ch == ',') {
            putchar(ch);
            putchar('\n');
            for (int i = 0; i < depth * 2; i++) putchar(' ');
        } else if (ch == ':') {
            printf(": ");
        } else {
            putchar(ch);
        }
    }
    putchar('\n');
}

static int read_input(const char *prompt, char *out, size_t capacity) {
    printf("%s", prompt);
    fflush(stdout);
    if (!fgets(out, (int)capacity, stdin)) return 0;
    size_t len = strcspn(out, "\r\n");
    if (out[len] == '\0' && len == capacity - 1) {
        int ch;
        while ((ch = getchar()) != '\n' && ch != EOF) {}
        printf("Input is too long.\n");
        return -1;
    }
    out[len] = '\0';
    if (!len) return -1;
    if (strchr(out, '|')) {
        printf("The | character is reserved by the report protocol.\n");
        return -1;
    }
    return 1;
}

static int read_optional_input(const char *prompt, char *out, size_t capacity) {
    printf("%s", prompt);
    fflush(stdout);
    if (!fgets(out, (int)capacity, stdin)) return 0;
    size_t len = strcspn(out, "\r\n");
    if (out[len] == '\0' && len == capacity - 1) {
        int ch;
        while ((ch = getchar()) != '\n' && ch != EOF) {}
        printf("Input is too long.\n");
        return -1;
    }
    out[len] = '\0';
    if (strchr(out, '|')) {
        printf("The | character is reserved by the report protocol.\n");
        return -1;
    }
    return 1;
}

static int send_udp_request(const char *host, const char *message,
                            char *response, size_t response_capacity,
                            int *error_code) {
    if (response_capacity < 2 || response_capacity > INT_MAX) {
        *error_code = WSAEINVAL;
        return 0;
    }
    struct addrinfo hints = {0}, *result = NULL;
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_DGRAM;
    *error_code = getaddrinfo(host, "9091", &hints, &result);
    if (*error_code != 0) return 0;

    SOCKET sock = socket(result->ai_family, result->ai_socktype, result->ai_protocol);
    if (sock == INVALID_SOCKET) {
        *error_code = WSAGetLastError();
        freeaddrinfo(result);
        return 0;
    }

    DWORD timeout_ms = 3000;
    if (setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO,
                   (const char *)&timeout_ms, sizeof(timeout_ms)) == SOCKET_ERROR ||
        connect(sock, result->ai_addr, (int)result->ai_addrlen) == SOCKET_ERROR) {
        *error_code = WSAGetLastError();
        closesocket(sock);
        freeaddrinfo(result);
        return 0;
    }

    size_t message_length = strlen(message);
    if (!message_length || message_length > INT_MAX ||
        send(sock, message, (int)message_length, 0) == SOCKET_ERROR) {
        *error_code = WSAGetLastError();
        closesocket(sock);
        freeaddrinfo(result);
        return 0;
    }

    int received = recv(sock, response, (int)response_capacity - 1, 0);
    if (received == SOCKET_ERROR) {
        *error_code = WSAGetLastError();
        closesocket(sock);
        freeaddrinfo(result);
        return *error_code == WSAETIMEDOUT ? 2 : 0;
    }
    response[received] = '\0';
    closesocket(sock);
    freeaddrinfo(result);
    return 1;
}

int main(int argc, char *argv[]) {
    const char *host = argc > 1 ? argv[1] : "127.0.0.1";
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        fprintf(stderr, "WSAStartup failed.\n");
        return 1;
    }

    struct addrinfo hints = {0}, *result = NULL;
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    SOCKET tcp = INVALID_SOCKET;
    int resolve_error = getaddrinfo(host, TCP_PORT, &hints, &result);
    if (resolve_error != 0) {
        fprintf(stderr, "TCP unavailable: could not resolve server %s (error %d).\n",
                host, resolve_error);
    } else {
        tcp = socket(result->ai_family, result->ai_socktype, result->ai_protocol);
        if (tcp == INVALID_SOCKET ||
            connect(tcp, result->ai_addr, (int)result->ai_addrlen) == SOCKET_ERROR) {
            int connect_error = WSAGetLastError();
            fprintf(stderr, "TCP unavailable for %s:%s (error %d); UDP commands remain available.\n",
                    host, TCP_PORT, connect_error);
            if (tcp != INVALID_SOCKET) closesocket(tcp);
            tcp = INVALID_SOCKET;
        } else {
            printf("Connected to NetLink TCP server %s:%s.\n", host, TCP_PORT);
        }
        freeaddrinfo(result);
    }

    printf("Commands: report | list | detail | status | udp | udp-list | udp-status | quit\n");

    char command[32], road[121], locality[121], alert_location[121], alert_locality[121];
    char latitude[64], longitude[64], severity[16], traffic[16], alert_id[32];
    char immediate_danger[8];
    char description[281], report_id[32], status[32];
    char request[MAX_LINE], response[131072];
    char udp_request[256], udp_response[32768];
    while (1) {
        int list_request = 0;
        int input = read_input("netlink> ", command, sizeof(command));
        if (input == 0) break;
        if (input < 0) continue;

        if (!_stricmp(command, "quit")) break;
        if (tcp == INVALID_SOCKET &&
            (!_stricmp(command, "report") || !_stricmp(command, "list") ||
             !_stricmp(command, "detail") || !_stricmp(command, "status"))) {
            printf("That command needs TCP on %s:%s. UDP commands are still available.\n",
                   host, TCP_PORT);
            continue;
        }
        if (!_stricmp(command, "udp")) {
            input = read_input("Road or street: ", alert_location, sizeof(alert_location));
            if (input <= 0) continue;
            input = read_input("Area or locality: ", alert_locality, sizeof(alert_locality));
            if (input <= 0) continue;
            input = read_input("Severity (Low/Medium/High): ", severity, sizeof(severity));
            if (input <= 0) continue;
            input = read_input("Traffic impact (Low/Medium/High): ", traffic, sizeof(traffic));
            if (input <= 0) continue;
            input = read_input("Anyone injured or in immediate danger? (Yes/No): ",
                               immediate_danger, sizeof(immediate_danger));
            if (input > 0) {
                if (strlen(alert_location) > 120 || strlen(alert_locality) > 120 ||
                    (_stricmp(severity, "Low") && _stricmp(severity, "Medium") &&
                     _stricmp(severity, "High")) ||
                    (_stricmp(traffic, "Low") && _stricmp(traffic, "Medium") &&
                     _stricmp(traffic, "High")) ||
                    (_stricmp(immediate_danger, "Yes") &&
                     _stricmp(immediate_danger, "No"))) {
                    printf("Enter valid severity, traffic, danger, road, and locality values.\n");
                } else {
                    printf("UDP destination: %s:%d\n", host, UDP_PORT);
                    int n = snprintf(udp_request, sizeof(udp_request),
                                     "ALERT_V2|%s|%s|%s|%s|%s", severity, traffic,
                                     immediate_danger, alert_location, alert_locality);
                    if (n < 0 || n >= (int)sizeof(udp_request)) {
                        printf("UDP alert is too large to send.\n");
                        continue;
                    }
                    printf("UDP datagram: %s\n", udp_request);
                    int udp_error = 0;
                    int udp_result = send_udp_request(
                        host, udp_request, udp_response, sizeof(udp_response), &udp_error);
                    if (udp_result == 1 &&
                        sscanf(udp_response, "ACK|OK|%31[^|]", alert_id) == 1)
                        printf("Alert stored and acknowledged. Alert ID: %s (initial status: Pending).\n",
                               alert_id);
                    else if (udp_result == 1 && !strncmp(udp_response, "NACK|", 5))
                        printf("UDP alert rejected: %s\n", udp_response + 5);
                    else if (udp_result == 1)
                        printf("Received an unexpected UDP response; delivery is unconfirmed.\n");
                    else if (udp_result == 2)
                        printf("No UDP acknowledgement received within 3 seconds; delivery is unconfirmed.\n");
                    else
                        printf("UDP operation failed (network error %d).\n", udp_error);
                }
            }
            continue;
        }
        if (!_stricmp(command, "udp-list")) {
            int udp_error = 0;
            int udp_result = send_udp_request(host, "ALERTS", udp_response,
                                              sizeof(udp_response), &udp_error);
            if (udp_result == 1 && udp_response[0] == '{')
                print_json_response("UDP alerts", udp_response);
            else if (udp_result == 2)
                printf("No UDP alert-list response received within 3 seconds.\n");
            else if (udp_result == 1)
                printf("Unexpected UDP alert-list response: %s\n", udp_response);
            else
                printf("Could not request UDP alerts (network error %d).\n", udp_error);
            continue;
        }
        if (!_stricmp(command, "udp-status")) {
            input = read_input("UDP alert ID: ", alert_id, sizeof(alert_id));
            if (input <= 0) continue;
            input = read_input("New status (Pending/Under Review/In Progress/Resolved): ",
                               status, sizeof(status));
            if (input <= 0) continue;
            int n = snprintf(udp_request, sizeof(udp_request),
                             "ALERT_STATUS|%s|%s", alert_id, status);
            if (n < 0 || n >= (int)sizeof(udp_request)) {
                printf("UDP status request is too large.\n");
                continue;
            }
            int udp_error = 0;
            int udp_result = send_udp_request(host, udp_request, udp_response,
                                              sizeof(udp_response), &udp_error);
            char acknowledged_id[32], acknowledged_status[32];
            if (udp_result == 1 &&
                sscanf(udp_response, "ACK|STATUS|%31[^|]|%31[^|]",
                       acknowledged_id, acknowledged_status) == 2)
                printf("Alert %s status updated to %s.\n",
                       acknowledged_id, acknowledged_status);
            else if (udp_result == 1 && !strncmp(udp_response, "NACK|", 5))
                printf("UDP status update rejected: %s\n", udp_response + 5);
            else if (udp_result == 2)
                printf("No UDP status acknowledgement received within 3 seconds; update is unconfirmed.\n");
            else if (udp_result == 1)
                printf("Unexpected UDP status response: %s\n", udp_response);
            else
                printf("Could not update UDP alert status (network error %d).\n", udp_error);
            continue;
        }
        if (!_stricmp(command, "report")) {
            input = read_input("Road or street (max 120 characters): ", road, sizeof(road));
            if (input <= 0) continue;
            input = read_input("Area or locality (max 120 characters): ", locality, sizeof(locality));
            if (input <= 0) continue;
            input = read_input("Severity (Low/Medium/High): ", severity, sizeof(severity));
            if (input <= 0) continue;
            input = read_input("Traffic level (Low/Medium/High): ", traffic, sizeof(traffic));
            if (input <= 0) continue;
            input = read_input("Anyone injured or in immediate danger? (Yes/No): ",
                               immediate_danger, sizeof(immediate_danger));
            if (input <= 0) continue;
            input = read_optional_input("Latitude (optional, blank to skip): ", latitude, sizeof(latitude));
            if (input <= 0) continue;
            input = read_optional_input("Longitude (optional, blank to skip): ", longitude, sizeof(longitude));
            if (input <= 0) continue;
            input = read_input("Short description (max 280 characters): ", description, sizeof(description));
            if (input <= 0) continue;
            if (strlen(road) > 120 || strlen(locality) > 120 ||
                strlen(description) > 280 ||
                strchr(severity, '|') || strchr(description, '|') ||
                (_stricmp(immediate_danger, "Yes") &&
                 _stricmp(immediate_danger, "No"))) {
                printf("One or more fields exceed their limits or contain |.\n");
                continue;
            }
            int n = snprintf(request, sizeof(request),
                             "REPORT|%s|%s|%s|%s|%s|%s|%s|%s\n",
                             severity, traffic, road, locality, latitude, longitude,
                             description, immediate_danger);
            if (n < 0 || n >= (int)sizeof(request)) {
                printf("Report is too large to send.\n");
                continue;
            }
        } else if (!_stricmp(command, "detail")) {
            input = read_input("Report ID: ", report_id, sizeof(report_id));
            if (input <= 0) continue;
            snprintf(request, sizeof(request), "DETAIL|%s\n", report_id);
        } else if (!_stricmp(command, "status")) {
            input = read_input("Report ID: ", report_id, sizeof(report_id));
            if (input <= 0) continue;
            input = read_input("New status (Pending/Under Review/In Progress/Resolved): ",
                               status, sizeof(status));
            if (input <= 0) continue;
            int n = snprintf(request, sizeof(request), "STATUS|%s|%s\n",
                             report_id, status);
            if (n < 0 || n >= (int)sizeof(request)) {
                printf("Status request is too large.\n");
                continue;
            }
        } else if (!_stricmp(command, "list")) {
            strcpy(request, "LIST\n");
            list_request = 1;
        } else {
            printf("Use report, list, detail, status, udp, or quit.\n");
            continue;
        }

        if (tcp == INVALID_SOCKET) {
            printf("TCP command unavailable: no TCP connection to %s:%s. UDP commands are still available.\n",
                   host, TCP_PORT);
            continue;
        }
        if (!send_all(tcp, request, (int)strlen(request)) ||
            !recv_line(tcp, response, sizeof(response))) {
            printf("TCP connection lost.\n");
            closesocket(tcp);
            tcp = INVALID_SOCKET;
            continue;
        }
        if (!list_request || !print_report_list(response)) {
            if (list_request)
                fprintf(stderr, "Could not format the TCP report list; raw response follows:\n");
            if (response[0] == '{')
                print_json_response("TCP server", response);
            else
                printf("TCP server: %s\n", response);
        }
    }

    if (tcp != INVALID_SOCKET) {
        shutdown(tcp, SD_BOTH);
        closesocket(tcp);
    }
    WSACleanup();
    printf("Client closed.\n");
    return 0;
}
