// utils/s3.js (multer configuration file)
const { S3Client } = require('@aws-sdk/client-s3');
const multer = require('multer');
const multerS3 = require('multer-s3');

// Set up AWS S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Set up multer and S3 storage
const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.AWS_S3_BUCKET,  // Your S3 bucket name
    acl: 'public-read',  // Set the permission to read publicly
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      cb(null, `uploads/${Date.now()}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },  // Limit to 10 MB per file
});

// Define multer fields (expecting 2 files)
const uploadDriverDocuments = upload.fields([
  { name: 'licenseImage', maxCount: 1 },  // Expect 1 license image
  { name: 'vehicleImage', maxCount: 1 },  // Expect 1 vehicle image
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
  }
  next(error);
};

module.exports = { uploadDriverDocuments, handleUploadError };
