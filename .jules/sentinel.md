## 2024-05-24 - [IP Spoofing Bypass in Rate Limiting]

**Vulnerability:** Rate limiting relied on `split(',')[0]` for the `X-Forwarded-For` header, allowing attackers to spoof their IP by prepending an arbitrary IP address, thereby bypassing rate limits.
**Learning:** The first IP in `X-Forwarded-For` is untrusted and user-controllable. The proxy (like Railway) appends the true client IP to the end of the list.
**Prevention:** Always use the rightmost IP address appended by the trusted proxy, e.g., `split(',').at(-1)`, for security features like rate limiting.
