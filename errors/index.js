'use strict';

/**
 * Base error for custom errors thrown by VoucherAPI function app.
 */
class BaseError extends Error {
    constructor (message, code) {
        super(message);
        this.name = 'OrdersApiFunctionsBaseError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.BaseError = BaseError;

class UserNotAuthenticatedError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'UserNotAuthenticatedError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.UserNotAuthenticatedError = UserNotAuthenticatedError;

class AccessTokenAuthenticationError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'AccessTokenAuthenticationError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.AccessTokenAuthenticationError = AccessTokenAuthenticationError;

class OrdersApiServerError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'OrdersApiServerError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.OrdersApiServerError = OrdersApiServerError;

class RefundExpired  extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'RefundExpired';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.RefundExpired = RefundExpired;

class OrderNotFoundError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'OrderNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.OrderNotFoundError = OrderNotFoundError;

class PosSessionNotFoundError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'PosSessionNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.PosSessionNotFoundError = PosSessionNotFoundError;

class CheckoutSessionNotFoundError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'CheckoutSessionNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.CheckoutSessionNotFoundError = CheckoutSessionNotFoundError;

class SwishPaymentNotFoundError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'SwishPaymentNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.SwishPaymentNotFoundError = SwishPaymentNotFoundError;

class RetailTransactionNotFoundError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'RetailTransactionNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.RetailTransactionNotFoundError = RetailTransactionNotFoundError;

class ReceiptNotFoundError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'ReceiptNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.ReceiptNotFoundError = ReceiptNotFoundError;

class PaymentReceiptError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'PaymentReceiptError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.PaymentReceiptError = PaymentReceiptError;

class ZReportNotFoundError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'ZReportNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.ZReportNotFoundError = ZReportNotFoundError;

class POSSessionNotFoundError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'POSSessionNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.POSSessionNotFoundError = POSSessionNotFoundError;

class countUpSessionNotFoundError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'CountUpSessionNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.countUpSessionNotFoundError = countUpSessionNotFoundError;

class SessionNotFoundError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'SessionNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.SessionNotFoundError = SessionNotFoundError;

class PaymentNotRefundableError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'PaymentNotRefundableError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.PaymentNotRefundableError = PaymentNotRefundableError;

class CheckOutSessionNotFoundError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'CheckOutSessionNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.CheckOutSessionNotFoundError = CheckOutSessionNotFoundError;

class PaymentStatusNotFoundError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'PaymentStatusNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.PaymentStatusNotFoundError = PaymentStatusNotFoundError;

class VoucherNotFoundError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'VoucherNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.VoucherNotFoundError = VoucherNotFoundError;

class RefundNotAllowed extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'RefundNotAllowed';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.RefundNotAllowed = RefundNotAllowed;

class PaymentTransactionError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'PaymentTransactionError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.PaymentTransactionError = PaymentTransactionError;

class InvalidUUIDError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'InvalidUUIDError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.InvalidUUIDError = InvalidUUIDError;

class DuplicateOrderError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'DuplicateOrderError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.DuplicateOrderError = DuplicateOrderError;

class PointOfServiceRelatedError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'PointOfServiceRelatedError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.PointOfServiceRelatedError = PointOfServiceRelatedError;

class SwishPaymentError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'PaymentError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.SwishPaymentError = SwishPaymentError;

class VippsPaymentError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'VippsPaymentError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.VippsPaymentError = VippsPaymentError;

class BinancePaymentError extends BaseError {
    constructor (message, code) {
        super(message, code);
        this.name = 'BinancePaymentError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.BinancePaymentError = BinancePaymentError;

class EmptyRequestBodyError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'EmptyRequestBodyError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.EmptyRequestBodyError = EmptyRequestBodyError;

class ZReportNotExistError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'ZReportNotExistError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.ZReportNotExistError = ZReportNotExistError;

class MissingStripeAmountError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'MissingStripeAmountError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.MissingStripeAmountError = MissingStripeAmountError;

class MissingStripeVatAmountError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'MissingStripeVatAmountError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.MissingStripeVatAmountError = MissingStripeVatAmountError;

class MissingStripeCurrencyError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'MissingStripeCurrencyError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.MissingStripeCurrencyError = MissingStripeCurrencyError;

class MissingStripeDescriptionError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'MissingStripeDescriptionError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.MissingStripeDescriptionError = MissingStripeDescriptionError;

class MissingStripeTokenError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'MissingStripeTokenError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.MissingStripeTokenError = MissingStripeTokenError;

class MissingStripeReceiptEmailError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'MissingStripeReceiptEmailError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.MissingStripeReceiptEmailError = MissingStripeReceiptEmailError;

class MissingStripeUserSessionIdError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'MissingStripeUserSessionIdError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.MissingStripeUserSessionIdError = MissingStripeUserSessionIdError;

class WebShopNotFoundError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'WebShopNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.WebShopNotFoundError = WebShopNotFoundError;

class CartNotFoundError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'CartNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.CartNotFoundError = CartNotFoundError;

class ProductApiError extends BaseError {
    constructor (name, message, code) {
        super(message, code);
        this.name = name;
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.ProductApiError = ProductApiError;

class PaymentApiError extends BaseError {
    constructor (name, message, code) {
        super(message, code);
        this.name = name;
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.PaymentApiError = PaymentApiError;

class MissingStripeCustomerError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'MissingStripeCustomerError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}

exports.MissingStripeCustomerError = MissingStripeCustomerError;

class WalletNotFoundError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'WalletNotFoundError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.WalletNotFoundError = WalletNotFoundError;

class MissingSwishPhoneError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'MissingSwishPhoneError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.MissingSwishPhoneError = MissingSwishPhoneError;

class LowValueOrderNotFound extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'LowValueOrderNotFound';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.LowValueOrderNotFound = LowValueOrderNotFound;

class FieldValidationError extends BaseError {
    constructor (message, code) {
        super(message);
        this.name = 'FieldValidationError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.FieldValidationError = FieldValidationError;
