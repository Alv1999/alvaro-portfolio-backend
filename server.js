// alvaro-portfolio-backend/server.js
// ============================================================
// Backend de contacto: Express + Nodemailer (Gmail App Password)
// - Lee .env (SMTP_* y CONTACT_TO)
// - CORS permitido para Live Server y tu GitHub Pages
// - Endpoint: POST /api/contact (nombre, email, telefono, mensaje, asunto opcional)
// ============================================================

require("dotenv").config(); // lee variables de .env
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();

// --- CORS ---
// Permitimos Live Server en local. Más adelante agregamos GitHub Pages / dominio.
const whitelist = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://alv1999.github.io", // tu user page
  // "https://alv1999.github.io/tu-repo", // cuando publiques el front en Pages, si lo usás
];

app.use(
  cors({
    origin(origin, cb) {
      // permite herramientas sin origin (curl, Postman) y valida navegadores
      if (!origin || whitelist.some((w) => origin.startsWith(w)))
        return cb(null, true);
      cb(new Error("CORS: origen no permitido -> " + origin));
    },
  })
);

app.use(express.json());

// --- Salud ---
app.get("/", (_req, res) => res.send("Servidor backend funcionando 🚀"));

// --- Endpoint: /api/contact ---
app.post("/api/contact", async (req, res) => {
  try {
    const { nombre, email, telefono, mensaje, asunto } = req.body || {};

    // Validación mínima
    if (!nombre || !email || !mensaje) {
      return res
        .status(400)
        .json({ ok: false, error: "Faltan campos requeridos" });
    }

    // Transport SMTP con Gmail App Password (desde .env)
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, // smtp.gmail.com
      port: Number(process.env.SMTP_PORT), // 465
      secure: process.env.SMTP_SECURE === "true", // true
      auth: {
        user: process.env.SMTP_USER, // tu gmail
        pass: process.env.SMTP_PASS, // app password SIN espacios (16 chars)
      },
    });

    // Verificación opcional (útil en dev; si falla, seguimos intentando enviar igual)
    try {
      await transporter.verify();
      console.log("SMTP listo ✅");
    } catch (vErr) {
      console.warn(
        "Aviso: verify() falló, intento enviar igual →",
        vErr?.message || vErr
      );
    }

    // Subject dinámico con "asunto" si vino
    const subject = asunto
      ? `(${asunto}) Nuevo mensaje de ${nombre}`
      : `Nuevo mensaje de ${nombre}`;

    // Cuerpo en texto plano (robusto)
    const text = `Nombre: ${nombre}
Email: ${email}
Teléfono: ${telefono || "-"}
Asunto: ${asunto || "-"}
Mensaje:
${mensaje}`;

    // (Opcional) versión HTML
    const html = `
      <h2>Nuevo contacto desde tu portfolio 🚀</h2>
      <p><b>Nombre:</b> ${nombre}</p>
      <p><b>Email:</b> ${email}</p>
      <p><b>Teléfono:</b> ${telefono || "-"}</p>
      <p><b>Asunto:</b> ${asunto || "-"}</p>
      <p><b>Mensaje:</b></p>
      <pre style="white-space:pre-wrap;font-family:inherit">${mensaje}</pre>
    `;

    const info = await transporter.sendMail({
      from: `"Portfolio Web" <${process.env.SMTP_USER}>`,
      to: process.env.CONTACT_TO, // a dónde te llega (tu mail)
      replyTo: email, // para que al responder vaya al remitente
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
    console.error("Error enviando correo ❌", err);
    return res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
});

// --- Arranque ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API escuchando en http://localhost:${PORT}`);
});
