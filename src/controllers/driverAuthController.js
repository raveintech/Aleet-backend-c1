const asyncHandler = require("express-async-handler");
const AuthService = require("../services/authService");
const generateToken = require("../utils/generateToken");
const {
  sendSuccess,
  sendError,
  sendValidationError,
} = require("../utils/responseHelper");
const logger = require("../utils/logger");



const driverSignupStart = asyncHandler(async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    const data = await AuthService.driverSignupStart({
      name,
      phone,
      email,
      password,
    });
    return sendSuccess(res, 200, "Verification code sent to your phone", data);
  } catch (error) {
    (req.log || logger).error({ err: error }, "Driver Signup Start Error");
    if (error.statusCode === 400)
      return sendValidationError(res, error.message);
    return sendError(res, error.statusCode || 500, error.message);
  }
});

const verifyDriverSignupOTPController = async (req, res, next) => {
  try {
    const result = await AuthService.verifyDriverSignupOTP(req.body);

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const driverSignupDocuments = asyncHandler(async (req, res) => {
  try {
    const { driverToken, ssn, vehicleTypes, hasOwnVehicle, hasForHireLicense } =
      req.body;
    const data = await AuthService.driverSignupDocuments({
      driverToken,
      ssn,
      vehicleTypes,
      hasOwnVehicle,
      hasForHireLicense,
      files: req.files,
    });

    return sendSuccess(res, 200, "Documents uploaded successfully", data);
  } catch (error) {
    // Log only message (not full error/stack) — the request body contains SSN
    (req.log || logger).error({ err: error?.message || "unknown error" }, "Driver Signup Documents Error");
    if (error.statusCode === 400)
      return sendValidationError(res, error.message);
    return sendError(res, error.statusCode || 500, error.message);
  }
});

const driverSignupComplete = asyncHandler(async (req, res) => {
  try {
    // Support both JSON and multipart/form-data (body may come from either)
    const body = req.body || {};
    const { docsToken, hasForHireLicense, authorizeBackgroundCheck } = body;

    if (!docsToken) {
      return sendValidationError(res, "docsToken is required");
    }

    const user = await AuthService.driverSignupComplete({
      docsToken,
      authorizeBackgroundCheck:
        authorizeBackgroundCheck === true ||
        authorizeBackgroundCheck === "true",
      files: req.files,
    });

    const token = generateToken(user._id, user.role);
    return sendSuccess(res, 201, "Driver account created successfully", {
      token,
      user,
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, "Driver Signup Complete Error");
    if (error.statusCode === 400)
      return sendValidationError(res, error.message);
    return sendError(res, error.statusCode || 500, error.message);
  }
});

module.exports = {
  driverSignupStart,
  verifyDriverSignupOTPController,
  driverSignupDocuments,
  driverSignupComplete,
};
