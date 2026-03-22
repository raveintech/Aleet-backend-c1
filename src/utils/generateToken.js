const jwt = require('jsonwebtoken');

const generateToken = (id,role) => {
  return jwt.sign({id}, process.env.JWT_SECRET, { expiresIn: '24h' });
};

module.exports = generateToken;
