/**
 * Auth Middleware
 * Validates JWT from Authorization: Bearer <token>
 * Attaches req.user = { id, username, role }
 */

const jwt = require("jsonwebtoken");

module.exports = async function auth(req, res, next) {
  const header = req.headers["authorization"];
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, username: payload.username, role: payload.role };

    if (req.db && req.method !== "GET") {
      const ipAddress = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;
      const userAgent = req.headers["user-agent"] || null;
      req.db.query(
        `INSERT INTO audit_logs (user_id, ip_address, user_agent, route, method)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.id, ipAddress, userAgent, req.originalUrl, req.method]
      ).catch(() => {});
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
