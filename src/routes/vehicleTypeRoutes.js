const express = require('express');
const {
  addVehicleType,
  getAllVehicleTypes,
  updateVehicleType,
  deleteVehicleType
} = require('../controllers/vehicleController');
const authenticateJWT = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

router.post('/add', requireAdmin, addVehicleType);
router.get('/', getAllVehicleTypes);
router.put('/update/:id', requireAdmin, updateVehicleType);
router.delete('/delete/:id', requireAdmin, deleteVehicleType); // ✅ Delete API

module.exports = router;
