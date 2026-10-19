import { describe, expect, it } from "vitest";
import {
  AppError,
  ExternalServiceError,
  NotFoundError,
  ValidationError,
} from "../src/lib/errors.js";

describe("AppError", () => {
  it("preserves code, message, status, and details", () => {
    const details = { field: "amount" };
    const error = new AppError("TEST_ERROR", "Something failed", 422, details);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe("AppError");
    expect(error.code).toBe("TEST_ERROR");
    expect(error.message).toBe("Something failed");
    expect(error.statusCode).toBe(422);
    expect(error.details).toEqual(details);
  });

  it("defaults to HTTP 500", () => {
    const error = new AppError("INTERNAL", "Internal failure");

    expect(error.statusCode).toBe(500);
  });
});

describe("NotFoundError", () => {
  it("uses the standard not-found code and status", () => {
    const error = new NotFoundError();

    expect(error.code).toBe("NOT_FOUND");
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe("Resource not found");
  });

  it("accepts a custom message", () => {
    const error = new NotFoundError("Invoice not found");

    expect(error.message).toBe("Invoice not found");
  });
});

describe("ValidationError", () => {
  it("uses the validation error code and status", () => {
    const details = { field: "currency" };
    const error = new ValidationError("Invalid currency", details);

    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe("Invalid currency");
    expect(error.details).toEqual(details);
  });
});

describe("ExternalServiceError", () => {
  it("defaults to HTTP 502", () => {
    const error = new ExternalServiceError("PAYPAL_ERROR", "PayPal failed");

    expect(error.code).toBe("PAYPAL_ERROR");
    expect(error.statusCode).toBe(502);
  });

  it("accepts a custom status and details", () => {
    const details = { providerStatus: 429 };
    const error = new ExternalServiceError(
      "PAYPAL_RATE_LIMIT",
      "Provider rate limited the request",
      429,
      details,
    );

    expect(error.statusCode).toBe(429);
    expect(error.details).toEqual(details);
  });
});
