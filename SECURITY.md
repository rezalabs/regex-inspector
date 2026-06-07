# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it
privately. **Do not disclose it publicly until we have had a chance to
address it.**

To report a vulnerability, send an email to
[security@rezalabs.com](mailto:security@rezalabs.com) with the following
information:

- **Subject**: "regex-inspector security vulnerability"
- **Description**: A clear description of the issue, including the type of
  vulnerability (e.g., ReDoS bypass, code injection, information disclosure)
- **Affected versions**: The versions you have confirmed are affected
- **Reproduction steps**: Minimal steps or a proof of concept to reproduce the
  issue
- **Impact**: What an attacker could achieve by exploiting the vulnerability
- **Suggested fix**: If you have ideas for how to address the issue

### What to expect

- **Acknowledgment**: You will receive an acknowledgment of your report within
  48 hours.
- **Investigation**: We will investigate the report and may follow up for
  additional details.
- **Resolution**: We will work on a fix and release it as soon as practical,
  depending on the severity and complexity of the issue.
- **Disclosure**: We will coordinate public disclosure with you after a fix has
  been released.

### Scope

This security policy covers the `regex-inspector` library itself, including its
source code, build tooling, and published npm packages. It does not cover
applications that use `regex-inspector` or third-party dependencies.

## Security Considerations

`regex-inspector` performs static analysis of regular expressions. It does not
execute untrusted regex patterns. However:

- Parsing a maliciously crafted regex string can consume CPU resources during
  analysis. Patterns exceeding 100,000 characters are rejected.
- If you use `regex-inspector` in a service that accepts user-provided regex
  patterns, always sandbox or timeout regex execution separately. The library
  detects ReDoS patterns but does not mitigate runtime denial-of-service
  against your application.

See the [Security Advisory](./README.md#security-advisory) in the README for
more context.

## Preferred Languages

We prefer all communications in English.
