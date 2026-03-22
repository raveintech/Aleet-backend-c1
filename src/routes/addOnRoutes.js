const express = require('express');
const { addAddOn, getAllAddOns, updateAddOn, deleteAddOn } = require('../controllers/addOnController');
const authenticateJWT = require('../middleware/authMiddleware');
const router = express.Router();

// Route to add a new add-on (admin access)
router.post('/add', authenticateJWT, addAddOn);

// Route to get all available add-ons (for customers while booking)
router.get('/',  getAllAddOns);
router.put('/update/:id', authenticateJWT, updateAddOn);
router.delete('/delete/:id', authenticateJWT, deleteAddOn);
module.exports = router;
