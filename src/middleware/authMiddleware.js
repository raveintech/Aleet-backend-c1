const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware to authenticate JWT token
const authenticateJWT = async (req, res, next) => {
  const token = req.header('Authorization') && req.header('Authorization').split(' ')[1];  // Extract token from 'Authorization' header

  if (!token) {
    return res.status(401).json({ msg: 'No token provided, authorization denied' });
  }

  try {
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Attach user info (userId and role) to the request object
    req.user = { id: decoded.id, role: decoded.role };

    next();  // Proceed to the next middleware or route handler
  } catch (err) {
    console.error(err);
    res.status(401).json({ msg: 'Token is not valid' });
  }
};

// Middleware to block drivers with status !== 'active'
const requireActiveDriver = async (req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const user = await User.findById(req.user.id).select('role driver.status').lean();

    if (!user || user.role !== 'driver') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (user.driver?.status !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Your account is not yet approved. You will be notified once approved.',
        status: user.driver?.status || 'draft',
      });
    }

    next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = authenticateJWT;
module.exports.authenticateJWT = authenticateJWT;
module.exports.requireActiveDriver = requireActiveDriver;
