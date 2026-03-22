const express = require('express');
const { 
  addVehicleType, 
  getAllVehicleTypes, 
  updateVehicleType, 
  deleteVehicleType 
} = require('../controllers/vehicleController');
const authenticateJWT = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/add', authenticateJWT, addVehicleType);
router.get('/', getAllVehicleTypes);
router.put('/update/:id', authenticateJWT, updateVehicleType);
router.delete('/delete/:id', authenticateJWT, deleteVehicleType); // ✅ Delete API

module.exports = router;
