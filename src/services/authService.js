const User = require('../models/User');
const UserService = require('./userService');
const Checkr = require('./checkrService');

class AuthServiceError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'AuthServiceError';
    this.statusCode = statusCode;
  }
}

const parseArrayInput = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [value];
    }
  }
  return [];
};

const validateRegistrationInput = (body = {}) => {
  const role = body.role || 'customer';

  if (role === 'driver') {
    const vehicleTypes = parseArrayInput(body.vehicleTypes).filter(Boolean);
    if (!vehicleTypes.length) {
      throw new AuthServiceError(
        'At least one vehicle type must be selected for drivers',
        400
      );
    }
  }
};

const autoInviteDriverToCheckr = async (userId) => {
  const fullUser = await User.findById(userId);
  if (!fullUser) {
    throw new AuthServiceError('User not found after registration', 404);
  }

  let candidateId = fullUser.driver?.checkr?.candidateId;
  if (!candidateId) {
    const candidate = await Checkr.createCandidate(fullUser);
    candidateId = candidate.id;
    fullUser.driver.checkr = {
      ...(fullUser.driver?.checkr || {}),
      candidateId,
    };
  }

  const inv = await Checkr.createInvitation({
    candidateId,
    pkg: process.env.CHECKR_DEFAULT_PACKAGE,
    nodeId: process.env.CHECKR_NODE_ID,
    work: null,
  });

  fullUser.driver.checkr = {
    ...(fullUser.driver?.checkr || {}),
    invitationId: inv.id,
    reportId: inv.report_id || fullUser.driver?.checkr?.reportId || null,
    status: 'invited',
    lastEvent: 'invitation.created',
    lastEventAt: new Date(),
  };

  const dash = process.env.CHECKR_DASHBOARD_BASE || 'https://dashboard.checkr.com';
  fullUser.driver.checkr.dashboardUrl = inv.report_id
    ? `${dash}/reports/${inv.report_id}`
    : `${dash}/candidates/${candidateId}`;

  await fullUser.save();
};

const registerUser = async (body, files) => {
  validateRegistrationInput(body);
  const user = await UserService.register(body, files);

  if (user.role !== 'driver' || !user.email) {
    return user;
  }

  try {
    await autoInviteDriverToCheckr(user._id);
  } catch (error) {
    console.error('Checkr auto-invite failed:', error?.response?.data || error.message);
  }

  return user;
};

module.exports = {
  registerUser,
  AuthServiceError,
};
