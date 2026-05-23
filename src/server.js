const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const connectDB = require('./config/db'); // 🟢 DB connection

// Load environment variables
dotenv.config({ path: require('path').resolve(__dirname, '../.env') });

const logger = require('./utils/logger');
const requestLogger = require('./middleware/requestLogger');

// Connect to MongoDB 🟡
connectDB();

const app = express();

// Trust the first reverse-proxy hop so `req.ip` reflects the real client IP
// when the service is deployed behind a load balancer. Without this,
// `express-rate-limit` keys on the LB's IP and the OTP/login/signup limits
// collapse to one global bucket (legit users blocked after 5 OTP attempts;
// attackers can spoof X-Forwarded-For). Increase the hop count if more than
// one trusted proxy sits in front of the app.
app.set('trust proxy', 1);

app.use(requestLogger);

app.get('/health', (req, res) => res.status(200).json({ status: 'Aleet Backend is running' }));

// Import routes
const userRoutes = require('./routes/userRoutes');
const authRoutes = require('./routes/authRoutes');
const vehicleTypeRoutes = require('./routes/vehicleTypeRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adminManagementRoutes = require('./routes/adminManagementRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const addOnRoutes = require('./routes/addOnRoutes');
const checkrRoutes = require('./routes/checkrRoutes');
const bankAccountRoutes = require('./routes/bankAccountRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes.js');
const dashboardRoutes = require('./routes/dashboardRoutes');
const paymentsRoutes = require('./routes/payments.routes');
const payoutRoutes = require('./routes/payoutRoutes');
const regionRoutes = require('./routes/regionRoutes');
const PaymentsController = require('./controllers/payments.controller');

const { errorHandler, notFound } = require('./middleware/errorHandler');

// Raw-body routes MUST come before express.json() so the body stream is not consumed
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), PaymentsController.webhook);
app.post('/checkr/webhooks/checkr', express.raw({ type: '*/*' }), require('./controllers/checkrController').webhook);

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/vehicle-types', vehicleTypeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/admins', adminManagementRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/addons', addOnRoutes);
app.use('/checkr', checkrRoutes);
app.use('/api/bank-accounts', bankAccountRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/payout', payoutRoutes);
app.use('/api/regions', regionRoutes);

// Error handlers
app.use(notFound);
app.use(errorHandler);

// Start server.
//
// SSN encryption boot order:
//   1. cryptoService boot-time assertion already ran at require time —
//      production refuses to load without a configured key source.
//   2. If KMS_PROVIDER=aws, unwrap the DEK BEFORE the listener accepts
//      requests, so the first encrypt() can't race the boot.
//   3. If KMS isn't configured, cryptoService falls back to the env-var key
//      on first use.
const PORT = process.env.PORT;
(async () => {
  try {
    const { initEncryption } = require('./services/kms');
    await initEncryption();
  } catch (err) {
    logger.error({ err }, 'SSN encryption initialization failed — refusing to start');
    process.exit(1);
  }
  app.listen(PORT, () => logger.info({ port: PORT }, 'Aleet backend listening'));
})();
