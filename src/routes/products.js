'use strict';

const express = require('express');
const { state, nextId } = require('../store');
const { requireBearer, requireAdmin } = require('../auth');
const { validate, validationFailed } = require('../middleware');

const router = express.Router();

const CATEGORIES = ['accessories', 'displays', 'furniture', 'peripherals'];

router.get('/products', (req, res) => {
  let results = [...state.products];

  if (req.query.search) {
    const term = String(req.query.search).toLowerCase();
    results = results.filter((p) => p.name.toLowerCase().includes(term));
  }
  if (req.query.category) {
    results = results.filter((p) => p.category === req.query.category);
  }
  if (req.query.inStock !== undefined) {
    results = results.filter((p) => p.inStock === (req.query.inStock === 'true'));
  }
  if (req.query.minRating) {
    results = results.filter((p) => p.rating >= Number(req.query.minRating));
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const total = results.length;
  const start = (page - 1) * limit;

  res.json({
    data: results.slice(start, start + limit),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  });
});

router.get('/products/categories', (req, res) => {
  res.json({ data: CATEGORIES });
});

router.get('/products/:id', (req, res) => {
  const product = state.products.find((p) => p.id === Number(req.params.id));
  if (!product) {
    return res.status(404).json({ error: 'Not Found', message: `No product with id ${req.params.id}` });
  }
  res.json(product);
});

router.post('/products', requireBearer, requireAdmin, (req, res) => {
  const errors = validate([
    { field: 'name', required: true, type: 'string', maxLength: 60 },
    { field: 'category', required: true, type: 'string', enum: CATEGORIES },
    { field: 'price', required: true, type: 'number', min: 0 },
    { field: 'stock', required: true, type: 'number', min: 0 },
  ], req.body || {});
  if (errors.length) return validationFailed(res, errors);

  const product = {
    id: nextId('product'),
    name: req.body.name,
    category: req.body.category,
    price: req.body.price,
    rating: req.body.rating ?? 0,
    stock: req.body.stock,
    inStock: req.body.stock > 0,
    createdAt: new Date().toISOString(),
  };
  state.products.push(product);
  res.status(201).json(product);
});

router.put('/products/:id', requireBearer, requireAdmin, (req, res) => {
  const index = state.products.findIndex((p) => p.id === Number(req.params.id));
  if (index === -1) {
    return res.status(404).json({ error: 'Not Found', message: `No product with id ${req.params.id}` });
  }
  const errors = validate([
    { field: 'name', required: true, type: 'string' },
    { field: 'category', required: true, type: 'string', enum: CATEGORIES },
    { field: 'price', required: true, type: 'number', min: 0 },
    { field: 'stock', required: true, type: 'number', min: 0 },
  ], req.body || {});
  if (errors.length) return validationFailed(res, errors);

  state.products[index] = {
    ...state.products[index],
    ...req.body,
    id: state.products[index].id,
    inStock: req.body.stock > 0,
    updatedAt: new Date().toISOString(),
  };
  res.json(state.products[index]);
});

router.delete('/products/:id', requireBearer, requireAdmin, (req, res) => {
  const index = state.products.findIndex((p) => p.id === Number(req.params.id));
  if (index === -1) {
    return res.status(404).json({ error: 'Not Found', message: `No product with id ${req.params.id}` });
  }
  state.products.splice(index, 1);
  res.status(204).send();
});

module.exports = router;
