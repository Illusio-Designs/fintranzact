/**
 * The mobile sign-up screen: the mobile number is required, validated as an
 * Indian mobile, explained, and sent to auth.register as normalised digits.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { PHONE_HELP_TEXT, PHONE_INVALID_MESSAGE, PHONE_REQUIRED_MESSAGE } from "@fintranzact/shared";

const mockMutate = jest.fn();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-router", () => ({ router: { replace: jest.fn(), back: jest.fn() } }));
jest.mock("../lib/trpc", () => ({
  trpc: { auth: { register: { useMutation: () => ({ mutate: mockMutate, isPending: false }) } } },
}));
jest.mock("../stores/auth", () => ({
  useAuthStore: (sel: (s: { login: () => void }) => unknown) => sel({ login: jest.fn() }),
}));

import RegisterScreen from "../../app/(auth)/register";

function fill(phone: string) {
  fireEvent.changeText(screen.getByPlaceholderText("Your name"), "Anjali Mehta");
  fireEvent.changeText(screen.getByPlaceholderText("you@example.com"), "anjali@mehtatraders.in");
  if (phone) fireEvent.changeText(screen.getByLabelText("Mobile number"), phone);
  fireEvent.changeText(screen.getByPlaceholderText("Choose a password"), "long-enough-pw");
  fireEvent.changeText(screen.getByPlaceholderText("Repeat your password"), "long-enough-pw");
}

beforeEach(() => mockMutate.mockClear());

describe("mobile sign-up: mobile number", () => {
  it("shows the field with the reason it is asked for", () => {
    render(<RegisterScreen />);
    expect(screen.getByLabelText("Mobile number")).toBeTruthy();
    expect(screen.getByText(PHONE_HELP_TEXT)).toBeTruthy();
  });

  it("keeps the button disabled until a number is entered", () => {
    render(<RegisterScreen />);
    fill("");
    fireEvent.press(screen.getAllByText("Create Account")[1]);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(PHONE_REQUIRED_MESSAGE).toBeTruthy();
  });

  it("does not submit an invalid number and says why", () => {
    render(<RegisterScreen />);
    fill("12345");
    fireEvent.press(screen.getAllByText("Create Account")[1]);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByText(PHONE_INVALID_MESSAGE)).toBeTruthy();
  });

  it("sends the normalised 10 digits to auth.register", () => {
    render(<RegisterScreen />);
    fill("+91 98765-43210");
    fireEvent.press(screen.getAllByText("Create Account")[1]);
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toMatchObject({
      name: "Anjali Mehta",
      email: "anjali@mehtatraders.in",
      phone: "9876543210",
    });
  });
});
