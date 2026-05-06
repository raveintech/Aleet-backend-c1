// utils/multer.js (local storage configuration)
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for local storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter to allow only images
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

// Set up multer with local storage
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024  // 10MB limit
  }
});

// Define multer fields for driver documents (step 3)
const uploadDriverDocuments = upload.fields([
  { name: 'licenseImage', maxCount: 1 },
  { name: 'vehicleImage', maxCount: 1 },
  { name: 'forHireLicenseImage', maxCount: 1 },
]);

// Define multer fields for driver signup complete (step 4)
const uploadDriverComplete = upload.fields([
  { name: 'forHireLicenseImage', maxCount: 1 },
]);

// No-file upload — parses multipart/form-data body fields only (no files expected)
const uploadNone = upload.none();

// Single for-hire license image upload (used by admin to attach Aleet-generated license)
const uploadSingleForHireLicense = upload.single('forHireLicenseImage');

// Avatar upload (used by /api/users/contact-info)
const uploadAvatar = upload.fields([
  { name: 'avatar', maxCount: 1 },
]);

// Error handling middleware
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large. Maximum size is 10MB.'
      });
    }
    return res.status(400).json({
      error: 'File upload error: ' + error.message
    });
  } else if (error.message === 'Only image files are allowed!') {
    return res.status(400).json({
      error: 'Only image files (JPEG, PNG, etc.) are allowed.'
    });
  }
  next(error);
};

/**
 * Build a fully-qualified URL for an uploaded file.
 * Falls back to a relative path when APP_URL is not set.
 *
 * @param {string} filename - multer file.filename
 * @returns {string}
 */
const fileUrl = (filename) => {
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  return base ? `${base}/uploads/${filename}` : `/uploads/${filename}`;
};

module.exports = { uploadDriverDocuments, uploadDriverComplete, uploadSingleForHireLicense, uploadAvatar, handleUploadError, uploadNone, fileUrl };
