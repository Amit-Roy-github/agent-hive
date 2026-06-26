import crypto from 'node:crypto';

const generateUUID = () => {
    return crypto.randomUUID();
};

const getUUIDLast12DigitInUpperCase = () => {
    return generateUUID().slice(-12).toUpperCase();
};

export {
    getUUIDLast12DigitInUpperCase,
};
