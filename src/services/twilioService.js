const twilio = require('twilio');

// Twilio configuration - using environment variables for security
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
const fromPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
// Initialize Twilio client
let client;
try {
  client = twilio(accountSid, authToken);
  console.log('Twilio client initialized successfully');
} catch (error) {
  console.error('Failed to initialize Twilio client:', error.message);
  client = null;
}

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
    // Format phone number (ensure it starts with +)
    let formattedPhone = phoneNumber;
    //  console.log(object)
    let message;
    message = await client.messages.create({
      body: `Your Swift Haven verification code is: ${otpCode}. This code will expire in 5 minutes.`,
      from: fromPhoneNumber,
      to: formattedPhone,
    });
    console.log('Messaging service failed, trying with phone number...');


    // console.log(`OTP sent successfully to ${formattedPhone}. Message SID: ${message.sid}`);

    return {
      success: true,
      // messageSid: message.sid,
      phoneNumber: formattedPhone
    };
  } catch (error) {
    console.error('Twilio SMS Error:', error);
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
