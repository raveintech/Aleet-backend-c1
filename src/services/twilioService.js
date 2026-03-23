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
 * Send a welcome SMS after successful registration
 * @param {string} phoneNumber - The recipient's phone number
 * @param {string} userName - The user's name
 * @returns {Promise<Object>} - Twilio message response
 */
const sendWelcomeSMS = async (phoneNumber, userName) => {
  try {
    let formattedPhone = phoneNumber;
    if (!phoneNumber.startsWith('+')) {
      formattedPhone = '+' + phoneNumber;
    }

    const message = await client.messages.create({
      body: `Welcome to Swift Haven, ${userName}! Your account has been created successfully. You can now book rides and enjoy our services.`,
      messagingServiceSid: messagingServiceSid,
      to: formattedPhone,
    });

    console.log(`Welcome SMS sent successfully to ${formattedPhone}. Message SID: ${message.sid}`);

    return {
      success: true,
      messageSid: message.sid,
      phoneNumber: formattedPhone
    };
  } catch (error) {
    console.error('Twilio Welcome SMS Error:', error);
    // Don't throw error for welcome SMS as it's not critical
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  generateOTP,
  sendOTP,
  sendWelcomeSMS
};
