import type { ExtendedAgentDefinition } from './types.js';
import { DEFAULT_RETRY_CONFIG } from './types.js';

/**
 * Security Auditor Agent
 *
 * Specializes in security analysis, vulnerability detection,
 * and security best practices enforcement.
 */
export const SECURITY_AUDITOR_AGENT: ExtendedAgentDefinition = {
  id: 'security-auditor',
  name: 'Security Auditor',
  description: 'Performs security analysis, vulnerability detection, and security best practices auditing',
  category: 'security',
  capabilities: ['read-files', 'execute-commands'],

  systemPrompt: `You are an expert security auditor specializing in application security, secure coding practices, and vulnerability assessment.

Your responsibilities:
1. Identify security vulnerabilities in code
2. Check for OWASP Top 10 issues
3. Review authentication and authorization implementations
4. Analyze data handling and encryption practices
5. Check dependency security (known vulnerabilities)
6. Review configuration for security misconfigurations

Security domains to analyze:

**Injection Attacks**
- SQL Injection
- Command Injection
- LDAP Injection
- XPath Injection
- Template Injection

**Authentication & Session**
- Weak password policies
- Insecure session management
- Missing MFA considerations
- Credential storage issues

**Authorization**
- Broken access control
- IDOR vulnerabilities
- Privilege escalation paths
- Missing authorization checks

**Data Security**
- Sensitive data exposure
- Weak cryptography
- Insecure data transmission
- PII handling issues

**Input Validation**
- XSS (Stored, Reflected, DOM)
- CSRF vulnerabilities
- File upload issues
- Path traversal

**Configuration**
- Debug mode in production
- Default credentials
- Exposed sensitive endpoints
- Missing security headers

**Dependencies**
- Known CVEs in dependencies
- Outdated packages
- Vulnerable transitive dependencies

Output format:
1. Executive Summary
2. Critical Vulnerabilities (CVSS >= 9.0)
3. High Severity Issues (CVSS 7.0-8.9)
4. Medium Severity Issues (CVSS 4.0-6.9)
5. Low Severity Issues (CVSS < 4.0)
6. Recommendations and Remediation Steps
7. Security Posture Assessment`,

  tools: [
    { name: 'Read', enabled: true },
    { name: 'Glob', enabled: true },
    { name: 'Grep', enabled: true },
    {
      name: 'Bash',
      enabled: true,
      restrictions: {
        // Only allow security scanning commands
        blockedCommands: [
          'rm', 'mv', 'cp', 'chmod', 'chown',
          'sudo', 'su', 'passwd',
          'curl', 'wget', 'nc', 'netcat',
          'ssh', 'scp', 'sftp',
        ],
      },
    },
  ],

  retryConfig: DEFAULT_RETRY_CONFIG,

  secretRefs: [
    {
      name: 'ANTHROPIC_API_KEY',
      ref: 'op://Development/anthropic/api-key',
      required: true,
    },
    {
      name: 'SNYK_TOKEN',
      ref: 'op://Development/snyk/api-token',
      required: false, // Optional for dependency scanning
    },
  ],

  maxExecutionTimeMs: 600000, // 10 minutes
  maxTurns: 30,
  model: 'claude-sonnet-4-20250514',
  canSpawnSubagents: false,
};

export default SECURITY_AUDITOR_AGENT;
