const twilio = require('twilio');

const clean = (value) =>
  String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');

// Twilio configuration - using environment variables for security
const accountSid = clean(process.env.TWILIO_ACCOUNT_SID);
const authToken = clean(process.env.TWILIO_AUTH_TOKEN);
const messagingServiceSid = clean(process.env.TWILIO_MESSAGING_SERVICE_SID);
const fromPhoneNumber = clean(process.env.TWILIO_PHONE_NUMBER);
const apiKeySid = clean(process.env.TWILIO_API_KEY_SID);
const apiKeySecret = clean(process.env.TWILIO_API_KEY_SECRET);
let client = null;

const getClient = () => {
  if (client) return client;

  // Prefer API key auth if provided, otherwise fallback to Account SID + Auth Token
  if (apiKeySid && apiKeySecret && accountSid) {
    client = twilio(apiKeySid, apiKeySecret, { accountSid });
    return client;
  }

  if (!accountSid || !authToken) {
    throw new Error(
      'Missing Twilio credentials. Set either TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET + TWILIO_ACCOUNT_SID.'
    );
  }

  client = twilio(accountSid, authToken);
  return client;
};

/**
 * Generate a 6-digit OTP code
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Send OTP via SMS using Twilio
 * @param {string} phoneNumber - The recipient's phone number
 * @param {string} otpCode - The OTP code to send
 * @returns {Promise<Object>} - Twilio message response
 */



const sendOTP = async (phoneNumber, otpCode) => {
  try {
    let formattedPhone = String(phoneNumber || '').trim();
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = `+${formattedPhone}`;
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV] SMS skipped. OTP for ${formattedPhone}: ${otpCode}`);
      return { sid: 'dev-mock', status: 'skipped' };
    }

    const messagePayload = {
      body: `Your Aleet verification code is: ${otpCode}. This code will expire in 5 minutes.`,
      to: formattedPhone,
    };

    console.log(messagePayload)

    if (messagingServiceSid) {
      messagePayload.messagingServiceSid = messagingServiceSid;
    } else if (fromPhoneNumber) {
      messagePayload.from = fromPhoneNumber;
    } else {
      throw new Error('Missing TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER');
    }

    await getClient().messages.create(messagePayload);

    return {
      success: true,
      phoneNumber: formattedPhone
    };
  } catch (error) {
    console.error('Twilio SMS Error:', error);
    if (error?.code === 20003) {
      throw new Error(
        'Failed to send OTP: Twilio authentication failed. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.'
      );
    }
    throw new Error(`Failed to send OTP: ${error.message}`);
  }
};

/**
 * Internal: send an SMS through Twilio.
 * Used by all non-OTP helpers (welcome, trip alerts, promos).
 * Returns { success, ... } and never throws — callers fire-and-forget.
 */
const sendSMS = async (phoneNumber, body) => {
  try {
    let formattedPhone = String(phoneNumber || '').trim();
    if (!formattedPhone) {
      return { success: false, error: 'Missing phone number' };
    }
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+' + formattedPhone;
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV] SMS skipped. Would send to ${formattedPhone}: ${body}`);
      return { success: true, sid: 'dev-mock', phoneNumber: formattedPhone };
    }

    const messagePayload = { body, to: formattedPhone };
    if (messagingServiceSid) {
      messagePayload.messagingServiceSid = messagingServiceSid;
    } else if (fromPhoneNumber) {
      messagePayload.from = fromPhoneNumber;
    } else {
      return { success: false, error: 'Missing TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER' };
    }

    const message = await getClient().messages.create(messagePayload);
    return { success: true, messageSid: message.sid, phoneNumber: formattedPhone };
  } catch (error) {
    console.error('Twilio SMS Error:', error?.message || error);
    return { success: false, error: error?.message || 'Unknown SMS error' };
  }
};

/**
 * Send a welcome SMS after successful registration.
 */
const sendWelcomeSMS = async (phoneNumber, userName) => {
  const name = userName ? `, ${userName}` : '';
  return sendSMS(
    phoneNumber,
    `Welcome to Aleet${name}! Your account is ready. Book your private driver any time at aleet.com.`
  );
};

// ---------------------------------------------------------------------------
// Trip-alert templates
// Keep messages short — every SMS segment past 160 chars costs extra.
// ---------------------------------------------------------------------------
const formatTripTime = (date) => {
  if (!date) return '';
  try {
    return new Date(date).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZone: 'America/New_York'
    });
  } catch (_e) {
    return '';
  }
};

const tripAlertTemplates = {
  guest_booking_received: ({ when }) =>
    `Aleet: Booking received${when ? ` for ${when}` : ''}. We're matching you with a driver — you'll be notified once assigned.`,

  guest_driver_assigned: ({ driverName, when }) =>
    `Aleet: ${driverName || 'Your driver'} has been assigned to your trip${when ? ` on ${when}` : ''}. Track details in the app.`,

  guest_trip_completed: () =>
    `Aleet: Your trip is complete. Thank you for riding with us — please rate your driver in the app.`,

  guest_trip_cancelled: () =>
    `Aleet: Your trip has been cancelled. We're sorry for the inconvenience — please rebook or contact support.`,

  driver_new_assignment: ({ when, pickup }) =>
    `Aleet: New trip assigned${when ? ` for ${when}` : ''}${pickup ? ` from ${pickup}` : ''}. Open the driver app to view details.`,

  driver_trip_offer: ({ when, pickup }) =>
    `Aleet: New trip available${when ? ` for ${when}` : ''}${pickup ? ` from ${pickup}` : ''}. Open the driver app to accept — first come, first served.`,
};

/**
 * Send a trip-alert SMS to a user.
 * Respects user.smsOptIn (transactional opt-out). Fire-and-forget — never throws.
 *
 * @param {Object} user - User document (must have phone + smsOptIn)
 * @param {string} templateKey - Key from tripAlertTemplates
 * @param {Object} vars - Template variables
 */
const sendTripAlert = async (user, templateKey, vars = {}) => {
  if (!user) return { success: false, error: 'Missing user' };
  if (user.smsOptIn === false) {
    return { success: false, skipped: true, reason: 'user opted out' };
  }

  const template = tripAlertTemplates[templateKey];
  if (!template) {
    console.error(`Twilio: unknown trip-alert template "${templateKey}"`);
    return { success: false, error: `Unknown template ${templateKey}` };
  }

  return sendSMS(user.phone, template(vars));
};

module.exports = {
  generateOTP,
  sendOTP,
  sendWelcomeSMS,
  sendTripAlert,
  formatTripTime,
};
