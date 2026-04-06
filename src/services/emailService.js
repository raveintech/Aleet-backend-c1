const nodemailer = require('nodemailer');

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error('Missing GMAIL_USER or GMAIL_APP_PASSWORD');
  }

  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  return transporter;
};

const sendPasswordResetEmail = async (email, resetLink) => {
  const mailer = getTransporter();
  const from = "Aleet <sanistray@gmail.com>"

  const result = await mailer.sendMail({
    from,
    to: email,
    subject: 'Reset your Aleet password',
    text: `Use this link to reset your password: ${resetLink}\nThis link expires in 30 minutes.`,
    html: `
      <p>Use this link to reset your Aleet password:</p>
      <p><a href="${resetLink}">${resetLink}</a></p>
      <p>This link expires in 30 minutes.</p>
    `,
  });

  return { success: true, messageId: result.messageId };
};

const sendVerificationCodeEmail = async (email, code) => {
  const mailer = getTransporter();
  const from = 'Aleet <sanistray@gmail.com>';

  const result = await mailer.sendMail({
    from,
    to: email,
    subject: 'Your Aleet verification code',
    text: `Your verification code is: ${code}\nThis code expires in 10 minutes.`,
    html: `
      <p>Your Aleet verification code:</p>
      <h2 style="letter-spacing:4px;">${code}</h2>
      <p>This code expires in 10 minutes. Do not share it with anyone.</p>
    `,
  });

  return { success: true, messageId: result.messageId };
};

module.exports = {
  sendPasswordResetEmail,
  sendVerificationCodeEmail,
};
