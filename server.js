const express = require('express');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const helmet = require('helmet');
const { check, validationResult } = require('express-validator');

const app = express();

// Security improvements
app.use(helmet()); // Secure HTTP headers
app.use(compression()); // Enable gzip compression

// Rate limiting middleware
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});

app.use(limiter);

// Middleware for parsing JSON
app.use(express.json());

// Example route with validation
app.post('/analyze', [
    check('stockSymbol').isString().notEmpty().withMessage('Stock symbol is required'),
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const stockSymbol = req.body.stockSymbol;
    // Add your stock analysis logic here
    res.send(`Analyzing stock: ${stockSymbol}`);
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
