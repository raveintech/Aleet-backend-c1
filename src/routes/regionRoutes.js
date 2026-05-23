const express = require('express');
const {
    getRegions,
    getAllRegions,
    addRegion,
    updateRegion,
    deleteRegion,
    setSameDayBlock,
    getRegionCapacity,
} = require('../controllers/regionController');
const authenticateJWT = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

// Public — used by booking wizard to populate region dropdown
router.get('/', getRegions);

// Admin only
router.get('/all', authenticateJWT, getAllRegions);
router.post('/', authenticateJWT, addRegion);
router.put('/:id', authenticateJWT, updateRegion);
router.delete('/:id', authenticateJWT, deleteRegion);
// Same-day engine admin endpoints (T-2.4.3) — admin-only; a logged-in customer
// or driver must not be able to flip a region's same-day off.
router.patch('/:id/same-day-block', requireAdmin, setSameDayBlock);
router.get('/:id/capacity', requireAdmin, getRegionCapacity);

module.exports = router;
