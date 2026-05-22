const express = require('express');
const {
    getRegions,
    getAllRegions,
    getSameDayStatus,
    addRegion,
    updateRegion,
    deleteRegion,
} = require('../controllers/regionController');
const authenticateJWT = require('../middleware/authMiddleware');

const router = express.Router();

// Public — used by booking wizard to populate region dropdown
router.get('/', getRegions);

// Public — live same-day availability for a region (used by the booking flow)
router.get('/:id/same-day-status', getSameDayStatus);

// Admin only
router.get('/all', authenticateJWT, getAllRegions);
router.post('/', authenticateJWT, addRegion);
router.put('/:id', authenticateJWT, updateRegion);
router.delete('/:id', authenticateJWT, deleteRegion);

module.exports = router;
