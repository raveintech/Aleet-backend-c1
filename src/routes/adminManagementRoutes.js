const express = require('express');
const router = express.Router();

const requireAdmin = require('../middleware/requireAdmin');
const { requirePermission } = require('../middleware/requireAdmin');
const {
    getAllAdmins,
    getAdminById,
    createAdmin,
    updateAdmin,
    deleteAdmin,
} = require('../controllers/adminManagementController');

// All routes require a valid admin token + super-admin permission
router.use(requireAdmin, requirePermission('super-admin'));

router.get('/', getAllAdmins);
router.get('/:id', getAdminById);
router.post('/', createAdmin);
router.put('/:id', updateAdmin);
router.delete('/:id', deleteAdmin);

module.exports = router;
