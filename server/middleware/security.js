/**
 * Security middleware — scans all data flowing through the API for
 * tokens, keys, passwords, and other credentials. Redacts matches
 * before they reach storage or WebSocket broadcast.
 *
 * Two layers:
 *   1. Pattern-based detection (regex) for known secret formats
 *   2. Context-aware field scanning for key/value pairs where the key
 *      implies a secret (e.g. "password", "token", "secret")
 */

// ── Known secret patterns ────────────────────────────────────────
// Each entry: { name, pattern, replacement }
const SECRET_PATTERNS = [
  // OpenAI / Anthropic / common AI API keys
  { name: 'OpenAI API key',       pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Anthropic API key',    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },

  // AWS
  { name: 'AWS access key',       pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'AWS secret key',       pattern: /(?<=(?:aws_secret|secret_key|SecretAccessKey)[^\n]{0,20})[A-Za-z0-9/+=]{40}/g },

  // GitHub
  { name: 'GitHub PAT',           pattern: /\bghp_[A-Za-z0-9]{36,}\b/g },
  { name: 'GitHub OAuth',         pattern: /\bgho_[A-Za-z0-9]{36,}\b/g },
  { name: 'GitHub App token',     pattern: /\bghs_[A-Za-z0-9]{36,}\b/g },
  { name: 'GitHub fine-grained',  pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },

  // Google
  { name: 'Google API key',       pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g },

  // Stripe
  { name: 'Stripe key',           pattern: /\b[sr]k_(live|test)_[A-Za-z0-9]{20,}\b/g },

  // Slack
  { name: 'Slack token',          pattern: /\bxox[bpras]-[A-Za-z0-9-]{10,}\b/g },

  // Private keys
  { name: 'Private key block',    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },

  // JWT tokens (three base64url segments)
  { name: 'JWT token',            pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },

  // Bearer tokens in strings
  { name: 'Bearer token',         pattern: /Bearer\s+[A-Za-z0-9_.~+/=-]{20,}/gi },

  // Generic hex tokens (64+ chars, common for secrets)
  { name: 'Hex secret',           pattern: /(?<=(?:token|secret|key|password|apikey|api_key)[^\n]{0,10})[0-9a-f]{64,}/gi },

  // Database connection strings with credentials
  { name: 'DB connection string', pattern: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/[^\s@]+:[^\s@]+@[^\s]+/gi },

  // npm tokens
  { name: 'npm token',            pattern: /\bnpm_[A-Za-z0-9]{36,}\b/g },

  // Heroku API key
  { name: 'Heroku API key',       pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, contextRequired: true },

  // SendGrid
  { name: 'SendGrid key',         pattern: /\bSG\.[A-Za-z0-9_-]{22,}\.[A-Za-z0-9_-]{22,}\b/g },

  // Twilio
  { name: 'Twilio key',           pattern: /\bSK[0-9a-fA-F]{32}\b/g },

  // Azure
  { name: 'Azure key',            pattern: /(?<=(?:AccountKey|SharedAccessKey)[^\n]{0,5})[A-Za-z0-9+/]{44}={0,2}/g },

  // DigitalOcean
  { name: 'DigitalOcean token',   pattern: /\bdop_v1_[a-f0-9]{64}\b/g },
  { name: 'DigitalOcean OAuth',   pattern: /\bdoo_v1_[a-f0-9]{64}\b/g },

  // Discord
  { name: 'Discord token',        pattern: /\b[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}\b/g },

  // Supabase
  { name: 'Supabase key',         pattern: /\bsbp_[a-f0-9]{40}\b/g },

  // Vercel
  { name: 'Vercel token',         pattern: /\bvercel_[A-Za-z0-9]{24,}\b/g },
];

// ── Sensitive field name patterns ────────────────────────────────
// If a JSON key matches these, the value is treated as potentially secret
const SENSITIVE_FIELD_NAMES = /^(password|passwd|pass|pwd|secret|token|api_?key|apikey|access_?key|secret_?key|private_?key|auth|authorization|credential|client_?secret|signing_?key|encryption_?key|bearer|session_?token|refresh_?token|access_?token|database_?url|db_?password|connection_?string|smtp_?password|ssh_?key|pgp_?key|master_?key|service_?key)$/i;

const REDACTED = '[REDACTED]';

// ── Redaction statistics (in-memory, for logging) ────────────────
let totalRedactions = 0;
let redactionLog = [];

/**
 * Scan a string for known secret patterns and return redacted version.
 */
function redactPatterns(str) {
  if (typeof str !== 'string' || str.length < 10) return { text: str, found: [] };

  const found = [];
  let result = str;

  for (const { name, pattern, contextRequired } of SECRET_PATTERNS) {
    // Reset regex state (global flag)
    pattern.lastIndex = 0;

    // For patterns needing context (like UUIDs), skip standalone scanning
    if (contextRequired) continue;

    const matches = result.match(pattern);
    if (matches) {
      for (const m of matches) {
        found.push({ type: name, preview: m.slice(0, 6) + '...' });
      }
      result = result.replace(pattern, REDACTED);
    }
  }

  return { text: result, found };
}

/**
 * Deep-walk an object. Redact string values that match secret patterns
 * or whose keys suggest sensitive content.
 */
function deepRedact(obj, path = '') {
  if (obj === null || obj === undefined) return { value: obj, findings: [] };

  const findings = [];

  if (typeof obj === 'string') {
    const { text, found } = redactPatterns(obj);
    for (const f of found) {
      findings.push({ ...f, path });
    }
    return { value: text, findings };
  }

  if (Array.isArray(obj)) {
    const result = [];
    for (let i = 0; i < obj.length; i++) {
      const { value, findings: f } = deepRedact(obj[i], `${path}[${i}]`);
      result.push(value);
      findings.push(...f);
    }
    return { value: result, findings };
  }

  if (typeof obj === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      const fieldPath = path ? `${path}.${key}` : key;

      // If the key name implies a secret, redact the entire value
      if (SENSITIVE_FIELD_NAMES.test(key) && val && typeof val === 'string' && val.length > 0) {
        findings.push({ type: 'sensitive_field', path: fieldPath, preview: `${key}=***` });
        result[key] = REDACTED;
        continue;
      }

      const { value, findings: f } = deepRedact(val, fieldPath);
      result[key] = value;
      findings.push(...f);
    }
    return { value: result, findings };
  }

  return { value: obj, findings };
}

/**
 * Express middleware — scans request body on POST/PUT/PATCH.
 * Redacts secrets in-place so downstream handlers never see raw credentials.
 */
export function securityScan(req, res, next) {
  // Only scan mutation requests with a body
  if (!req.body || !['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return next();
  }

  const { value, findings } = deepRedact(req.body);

  if (findings.length > 0) {
    totalRedactions += findings.length;
    const entry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      findings: findings.map(f => ({ type: f.type, path: f.path, preview: f.preview })),
    };
    redactionLog.push(entry);

    // Keep log bounded
    if (redactionLog.length > 500) {
      redactionLog = redactionLog.slice(-250);
    }

    console.warn(
      `[SECURITY] Redacted ${findings.length} secret(s) from ${req.method} ${req.path}:`,
      findings.map(f => `${f.type} at ${f.path}`).join(', ')
    );

    // Replace request body with redacted version
    req.body = value;
  }

  next();
}

/**
 * Returns security scan statistics — available at /api/security/stats.
 */
export function getSecurityStats() {
  return {
    total_redactions: totalRedactions,
    recent_redactions: redactionLog.slice(-20),
    patterns_loaded: SECRET_PATTERNS.length,
    sensitive_fields_pattern: SENSITIVE_FIELD_NAMES.source,
  };
}
