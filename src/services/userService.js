const { fileUrl } = require('../utils/multer');
const User = require("../models/User");

const normalizePhone = (raw) => {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return null;

  if (String(raw).trimStart().startsWith('+')) {
    return '+' + digits;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return '+' + digits;
  }

  if (digits.length === 10) {
    return '+1' + digits;
  }

  return '+' + digits;
};

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

  // Duplicate check for phone and optional email
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw new Error("Invalid phone number");

  const resolvedRole = role || 'customer';
  const existing = await User.findOne({ phone: normalizedPhone, role: resolvedRole });
  if (existing) throw new Error("User with this phone number already exists");
  if (email) {
    const existingByEmail = await User.findOne({ email: String(email).trim().toLowerCase(), role: resolvedRole });
    if (existingByEmail) throw new Error("User with this email already exists");
  }

  // Create user with phone-based registration
  const user = new User({
    name: name || "",
    email: email ? String(email).trim().toLowerCase() : null,
    phone: normalizedPhone,
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
      licenseImage: licenseImage ? fileUrl(licenseImage.filename) : null,
      vehicleImage: vehicleImage ? fileUrl(vehicleImage.filename) : null,
      tier: "S-Level",
      backgroundCheck: false,
      driverRating: 0,
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

// Find by email, optionally scoped to a role
const findByEmail = async (email, role) => {
  const query = { email: String(email || '').trim().toLowerCase() };
  if (role) query.role = role;
  return await User.findOne(query);
};

// Find by phone number — always normalizes before querying, optionally scoped to a role
const findByPhone = async (phone, role) => {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const query = { phone: normalized };
  if (role) query.role = role;
  return await User.findOne(query);
};

// Update phone verification status — normalizes phone before update
const updatePhoneVerification = async (phone, isVerified = true) => {
  const normalized = normalizePhone(phone);
  return await User.findOneAndUpdate(
    { phone: normalized },
    { isPhoneVerified: isVerified },
    { new: true }
  );
};

// Mask SSN: show only last 4 digits
const maskSSN = (ssn) => {
  if (!ssn) return null;
  const digits = String(ssn).replace(/\D/g, '');
  return `***-**-${digits.slice(-4)}`;
};

// Format user response — role-aware, no cross-role data leakage
const formatUser = (user) => {
  if (!user) return null;

  const base = {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isPhoneVerified: user.isPhoneVerified,
    active: user.active,
    avatar: user.avatar || null,
    createdAt: user.createdAt,
  };

  if (user.role === 'driver') {
    const d = user.driver || {};
    return {
      ...base,
      driver: {
        tier: d.tier,
        status: d.status,
        backgroundCheck: d.backgroundCheck,
        revisionNotes: d.status === 'needs_revision' ? (d.revisionNotes || null) : undefined,
        vehicleTypes: d.vehicleTypes,
        licenseImage: d.licenseImage,
        vehicleImage: d.vehicleImage,
        forHireLicenseImage: d.forHireLicenseImage,
        hasForHireLicense: d.hasForHireLicense,
        hasOwnVehicle: d.hasOwnVehicle,
        driverRating: d.driverRating,
        ssn: maskSSN(d.ssn),
        sLevel: d.sLevel,
        pro: d.pro,
        diamond: d.diamond,
        regions: Array.isArray(d.regions) ? d.regions : [],
        serveAllRegions: d.serveAllRegions !== false,
        checkr: d.checkr
          ? {
            status: d.checkr.status,
            lastEvent: d.checkr.lastEvent,
            lastEventAt: d.checkr.lastEventAt,
            dashboardUrl: d.checkr.dashboardUrl,
          }
          : undefined,
      },
    };
  }

  if (user.role === 'admin') {
    return {
      ...base,
      admin: user.admin,
    };
  }

  // customer
  return {
    ...base,
    preferences: user.preferences,
    subscriptionStatus: user.subscriptionStatus,
    subscriptionDetails: user.subscriptionDetails,
  };
};

module.exports = {
  normalizePhone,
  register,
  findByEmail,
  findByPhone,
  updatePhoneVerification,
  formatUser,
};
