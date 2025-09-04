// alvaro-portfolio-backend/server.js
// ============================================================
// Backend de contacto (Express + Nodemailer con Gmail App Password o SMTP externo)
// - Variables desde ENV (.env local / Render en prod)
// - CORS seguro con whitelist + override por ENV
// - Healthcheck: GET /health
// - Debug opcional: GET ${DEBUG_URL} (si existe y empieza con '/')
// - Endpoint de contacto: POST /api/contact
// ============================================================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
app.disable("x-powered-by"); // Oculta header de Express

// ============================================================
// Validación de variables requeridas
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
}

// ============================================================
// CORS
// ============================================================
// Whitelist base (dev local + GitHub Pages)
const baseWhitelist = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://alv1999.github.io",
];

// Orígenes extra desde ENV (coma-separados)
const envOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const WHITELIST = [...new Set([...baseWhitelist, ...envOrigins])];

// Opciones CORS
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // permite curl/Postman
    const allowed = WHITELIST.some((w) => origin === w || origin.startsWith(w));
    if (allowed) return cb(null, true);
    return cb(new Error("CORS bloqueado para origen: " + origin));
  },
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

// ============================================================
// Healthcheck
// ============================================================
app.get("/health", (_req, res) => res.status(200).send("ok"));
app.get("/", (_req, res) => res.send("Servidor backend funcionando 🚀"));

// ============================================================
// Debug opcional (blindado)
// ============================================================
const DEBUG_URL = (process.env.DEBUG_URL || "").trim();
if (DEBUG_URL && DEBUG_URL.startsWith("/")) {
  app.get(DEBUG_URL, (_req, res) => {
    res.status(200).json({
      ok: true,
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
}

// ============================================================
// Endpoint: POST /api/contact
// body: { nombre, email, telefono?, mensaje, asunto? }
// ============================================================
app.post("/api/contact", async (req, res, next) => {
  try {
    const { nombre, email, telefono, mensaje, asunto } = req.body || {};

    if (!nombre || !email || !mensaje) {
      return res
        .status(400)
        .json({ ok: false, error: "Faltan campos requeridos" });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ ok: false, error: "Email inválido" });
    }

    const smtpPort = Number(process.env.SMTP_PORT || 465);
    const smtpSecure =
      process.env.SMTP_SECURE !== undefined
        ? String(process.env.SMTP_SECURE) === "true"
        : smtpPort === 465;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: { minVersion: "TLSv1.2" },
    });

    try {
      await transporter.verify();
      console.log("SMTP listo ✅");
    } catch (vErr) {
      console.warn("Aviso: verify() falló →", vErr?.message || vErr);
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
// 404 y errores
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
// Start (Render requiere 0.0.0.0)
// ============================================================
const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, "0.0.0.0", () => {
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
