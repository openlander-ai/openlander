# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in OpenLander, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

### How to Report

1. Go to the [Security Advisories](https://github.com/openlander/openlander/security/advisories) page
2. Click "Report a vulnerability"
3. Provide a detailed description of the vulnerability

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Depends on severity
  - Critical: Patch within 48 hours
  - High: Patch within 1 week
  - Medium/Low: Next regular release

### Scope

Security issues we care about:

- Remote code execution
- Container escape
- Credential exposure (API keys, tokens)
- Unauthorized access to deployed services
- Path traversal or file system access
- Shell injection via user input

### Disclosure

We follow coordinated disclosure. We will:

1. Confirm the vulnerability
2. Develop and test a fix
3. Release the fix
4. Credit the reporter (unless they prefer anonymity)
5. Publish a security advisory
