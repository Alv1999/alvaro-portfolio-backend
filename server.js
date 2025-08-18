// alvaro-portfolio-backend/server.js
// ============================================================
// Backend de contacto (Express + Nodemailer con Gmail App Password)
// - Lee variables desde ENV (.env en local / Render en producción)
// - CORS seguro (whitelist base + CORS_ORIGIN por ENV; permite no-origin: curl/Postman)
// - Healthcheck para Render: GET /health
// - Debug opcional blindado por ENV: GET ${DEBUG_URL} (si existe y empieza con '/')
// - Endpoint de contacto: POST /api/contact
// ============================================================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
app.disable("x-powered-by"); // Oculta header de Express

// ============================================================
// Validación de variables requeridas al inicio (falla temprano)
// ============================================================
const REQUIRED_ENVS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "CONTACT_TO",
];
const missing = REQUIRED_ENVS.filter((k) => !process.env[k]);
if (missing.length) {
  console.warn("⚠️ Faltan variables de entorno:", missing.join(", "));
  // No hacemos process.exit() para no romper el deploy; fallará el envío si falta algo.
}

// ============================================================
// CORS
// ============================================================
// Whitelist base (local + GitHub Pages)
const baseWhitelist = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://localhost:5173", // Vite local
  "http://127.0.0.1:5173",
  "https://alv1999.github.io",
];

// Orígenes extra desde ENV (separados por coma)
const envOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Lista final sin duplicados
const WHITELIST = [...new Set([...baseWhitelist, ...envOrigins])];

// Opciones de CORS
const corsOptions = {
  origin(origin, cb) {
    // Permite herramientas sin "origin" (curl/Postman/crons)
    if (!origin) return cb(null, true);

    // Coincidencia exacta o que comience igual (útil con subrutas)
    const allowed = WHITELIST.some((w) => origin === w || origin.startsWith(w));
    if (allowed) return cb(null, true);

    return cb(new Error("CORS: origen no permitido → " + origin));
  },
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
// Responde preflight explícitamente (algunos proxies son sensibles)
app.options("*", cors(corsOptions));

// Body parser (subí el límite si un día adjuntás algo grande)
app.use(express.json({ limit: "1mb" }));

// ============================================================
// Healthchecks
// ============================================================
app.get("/health", (_req, res) => res.status(200).send("ok"));
app.get("/", (_req, res) => res.send("Servidor backend funcionando 🚀"));

// ============================================================
// Debug opcional (blindado)
// - Solo se registra si DEBUG_URL existe y comienza con '/'
// - Útil para chequear variables críticas en prod sin romper el deploy
// ============================================================
const DEBUG_URL = (process.env.DEBUG_URL || "").trim();
if (DEBUG_URL) {
  if (DEBUG_URL.startsWith("/")) {
    app.get(DEBUG_URL, (_req, res) => {
      res.status(200).json({
        ok: true,
        path: DEBUG_URL,
        envs: {
          SMTP_HOST: !!process.env.SMTP_HOST,
          SMTP_PORT: !!process.env.SMTP_PORT,
          SMTP_USER: !!process.env.SMTP_USER,
          SMTP_PASS: !!process.env.SMTP_PASS,
          CONTACT_TO: !!process.env.CONTACT_TO,
          CORS_ORIGIN: process.env.CORS_ORIGIN || "",
        },
        time: new Date().toISOString(),
      });
    });
    console.log(`Ruta de debug habilitada en ${DEBUG_URL}`);
  } else {
    console.warn("DEBUG_URL debe comenzar con '/'. Se ignora:", DEBUG_URL);
  }
}

// ============================================================
// Endpoint: POST /api/contact
// body: { nombre, email, telefono?, mensaje, asunto? }
// ============================================================
app.post("/api/contact", async (req, res, next) => {
  try {
    const { nombre, email, telefono, mensaje, asunto } = req.body || {};

    // Validación mínima
    if (!nombre || !email || !mensaje) {
      return res
        .status(400)
        .json({ ok: false, error: "Faltan campos requeridos" });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ ok: false, error: "Email inválido" });
    }

    // Config SMTP (Gmail)
    const smtpPort = Number(process.env.SMTP_PORT || 465);
    const smtpSecure =
      process.env.SMTP_SECURE !== undefined
        ? String(process.env.SMTP_SECURE) === "true"
        : smtpPort === 465; // por defecto true si 465

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, // smtp.gmail.com
      port: smtpPort, // 465
      secure: smtpSecure, // true
      auth: {
        user: process.env.SMTP_USER, // tu gmail
        pass: process.env.SMTP_PASS, // app password (16 chars)
      },
      tls: { minVersion: "TLSv1.2" }, // endurece TLS (Gmail lo soporta)
    });

    // Verificación opcional (no frena el envío si falla)
    try {
      await transporter.verify();
      console.log("SMTP listo ✅");
    } catch (vErr) {
      console.warn(
        "Aviso: verify() falló, intento enviar igual →",
        vErr?.message || vErr
      );
    }

    const subject = asunto
      ? `(${asunto}) Nuevo mensaje de ${nombre}`
      : `Nuevo mensaje de ${nombre}`;

    const text = `Nombre: ${nombre}
Email: ${email}
Teléfono: ${telefono || "-"}
Asunto: ${asunto || "-"}
Mensaje:
${mensaje}`;

    const html = `
      <h2>Nuevo contacto desde tu portfolio 🚀</h2>
      <p><b>Nombre:</b> ${escapeHtml(nombre)}</p>
      <p><b>Email:</b> ${escapeHtml(email)}</p>
      <p><b>Teléfono:</b> ${escapeHtml(telefono || "-")}</p>
      <p><b>Asunto:</b> ${escapeHtml(asunto || "-")}</p>
      <p><b>Mensaje:</b></p>
      <pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(
        mensaje
      )}</pre>
    `;

    const info = await transporter.sendMail({
      from: `"Portfolio Web" <${process.env.SMTP_USER}>`,
      to: process.env.CONTACT_TO,
      replyTo: email,
      subject,
      text,
      html,
    });

    console.log("Correo enviado ✅", {
      accepted: info.accepted,
      messageId: info.messageId,
    });
    return res.json({ ok: true, messageId: info.messageId });
  } catch (err) {
    return next(err);
  }
});

// ============================================================
// 404 y manejador de errores
// ============================================================
app.use((_req, res) =>
  res.status(404).json({ ok: false, error: "Ruta no encontrada" })
);

app.use((err, _req, res, _next) => {
  console.error("Error no controlado ❌", err);
  const msg = err?.message || "Error interno";
  res.status(500).json({ ok: false, error: msg });
});

// ============================================================
// Start
// ============================================================
const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`API escuchando en puerto ${PORT}`);
  console.log("CORS whitelist:", WHITELIST.join(", ") || "(vacía)");
});

// ============================================================
// Helpers
// ============================================================
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isEmail(s = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
}
