const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { check, validationResult } = require('express-validator');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for security improvements
app.use(helmet());
app.use(compression());

// Rate limiting middleware
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Middleware for parsing JSON data
app.use(express.json());

// Validation middleware example
app.post('/data', [
    check('name').isString().notEmpty(),
    check('email').isEmail(),
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    // Process valid data
    res.send('Data received');
});

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
