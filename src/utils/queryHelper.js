// utils/queryHelper.js

/**
 * Pagination helper
 * @param {Object} query - Express req.query object
 */
const getPagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.max(1, parseInt(query.limit) || 10);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

/**
 * Sorting helper
 * @param {string} sortBy - Field to sort
 * @param {string} order - 'asc' or 'desc'
 */
const getSorting = (sortBy = 'createdAt', order = 'desc') => {
  const sortOrder = order === 'asc' ? 1 : -1;

  // Example special case
  if (sortBy === 'ticketNumber') {
    return { ticketNumberInt: sortOrder, _id: 1 };
  }

  return { [sortBy]: sortOrder, _id: 1 };
};

/**
 * Search helper
 * User text ko poore document me search karne ke liye
 * @param {string} searchText
 * @param {Array<string>} fields - Konse fields me search karni hai
 */
const getSearchQuery = (searchText, fields) => {
  if (!searchText) return {};

  const regex = new RegExp(searchText, "i"); // case-insensitive
  return {
    $or: fields.map(field => ({ [field]: regex }))
  };
};

module.exports = {
  getPagination,
  getSorting,
  getSearchQuery
};
