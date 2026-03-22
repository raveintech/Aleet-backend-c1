const mongoose = require("mongoose");
const User = require("../models/User");

// Parse vehicleTypes
const parseVehicleTypes = (vehicleTypes) => {
  if (!vehicleTypes) return [];
  let vt = [];
  if (Array.isArray(vehicleTypes)) vt = vehicleTypes;
  else if (typeof vehicleTypes === "string" && vehicleTypes.trim() !== "") {
    try {
      vt = JSON.parse(vehicleTypes);
    } catch {
      vt = [vehicleTypes];
    }
  }
  return vt.map((v) => new mongoose.Types.ObjectId(v));
};

// Parse permissions
const parsePermissions = (permissions) => {
  if (!permissions) return [];
  let perms = permissions;
  if (typeof perms === "string") {
    try {
      perms = JSON.parse(perms);
    } catch {
      perms = perms
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return Array.isArray(perms) ? perms : [];
};

// Register new user (phone-based)
const register = async (body, files) => {
  const { name, email, phone, password, role, vehicleTypes, permissions, ssn } =
    body;

  // Duplicate check - only check phone for phone-based registration
  const existing = await User.findOne({ phone });
  if (existing) throw new Error("User with this phone number already exists");

  // Create user with phone-based registration
  const user = new User({
    name: name || "", // Optional name
    email: email || null, // Optional email
    phone,
    password: password || null, // Optional password
    role: role || "customer",
    isPhoneVerified: false, // Will be set to true after OTP verification
  });

  if (role === "driver") {
    const vt = parseVehicleTypes(vehicleTypes);
    const licenseImage = files?.licenseImage?.[0];
    const vehicleImage = files?.vehicleImage?.[0];

    user.driver = {
      ssn,
      vehicleTypes: vt,
      licenseImage: licenseImage ? `/uploads/${licenseImage.filename}` : null,
      vehicleImage: vehicleImage ? `/uploads/${vehicleImage.filename}` : null,
      tier: "S-Level",
      backgroundCheck: false,
      driverRating: 0,
      active: true,
      sLevel: {
        rentalUsed: false,
        rentalCost: 0,
        rentalSplit: { driver: 0, ceo: 0, coo: 0 },
      },
      pro: {
        chauffeurLicenseNumber: null,
        etiquetteTrainingCompleted: false,
      },
      diamond: {
        completedTrips: 0,
        noComplaints: true,
        luxuryVehicleApproved: false,
        sameDayBookingAvailable: false,
        diamondTrainingCompleted: false,
        instantPayoutEligible: false,
      },
      checkr: {},
    };
  }

  if (role === "admin") {
    user.admin = { permissions: parsePermissions(permissions) };
  }

  await user.save();
  return formatUser(user);
};

// Find by email
const findByEmail = async (email) => {
  return await User.findOne({ email });
};

// Find by phone number
const findByPhone = async (phone) => {
  return await User.findOne({ phone });
};

// Update phone verification status
const updatePhoneVerification = async (phone, isVerified = true) => {
  return await User.findOneAndUpdate(
    { phone },
    { isPhoneVerified: isVerified },
    { new: true }
  );
};

// Format user response
// Format user response
const formatUser = (user) => {
  if (!user) return null; // agar user hi na ho to null return kare

  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    driver: user.driver,
  };
};

module.exports = {
  register,
  findByEmail,
  findByPhone,
  updatePhoneVerification,
  formatUser,
};
