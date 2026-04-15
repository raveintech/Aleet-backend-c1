const express = require('express');
const router = express.Router();

const requireAdmin = require('../middleware/requireAdmin');
const {
    getAllAdmins,
    getAdminById,
    createAdmin,
    updateAdmin,
    deleteAdmin,
} = require('../controllers/adminManagementController');

router.use(requireAdmin);

router.get('/', getAllAdmins);
router.get('/:id', getAdminById);
router.post('/', createAdmin);
router.put('/:id', updateAdmin);
router.delete('/:id', deleteAdmin);

module.exports = router;
