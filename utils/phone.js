// utils/phone.js

const { parsePhoneNumberFromString } = require("libphonenumber-js");

function normalizePhone(phone, defaultCountry = "IN") {
  const parsed = parsePhoneNumberFromString(phone, defaultCountry);

  if (!parsed || !parsed.isValid()) {
    throw new Error("Invalid phone number");
  }

  // Return E.164 without "+"
  return parsed.number.replace("+", "");
}

module.exports = { normalizePhone };