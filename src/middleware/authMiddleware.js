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
    console.log(decoded.id)
    // Attach user info (userId and role) to the request object
    req.user = { id: decoded.id };


    next();  // Proceed to the next middleware or route handler
  } catch (err) {
    console.error(err);
    res.status(401).json({ msg: 'Token is not valid' });
  }
};

module.exports = authenticateJWT;
