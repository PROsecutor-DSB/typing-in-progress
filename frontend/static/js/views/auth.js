// Login and registration screens.

import { el, showError, clearError } from '../utils.js';
import { api } from '../api.js';
import { navigate } from '../router.js';

let onLoggedIn = async () => {};
let pendingNotice = '';

export function configureAuth({ afterLogin }) {
    onLoggedIn = afterLogin;
}

// setLoginNotice queues a message for the next time the login screen renders,
// so that a redirect can still explain itself.
export function setLoginNotice(notice) {
    pendingNotice = notice || '';
}

export function renderLogin() {
    const notice = pendingNotice;
    pendingNotice = '';

    el('app').innerHTML = `
        <div class="auth-box card">
            <h2>Login</h2>
            <div id="error-box" class="error-msg${notice ? ' visible' : ''}"></div>
            <form id="login-form">
                <div class="input-group">
                    <label for="identifier">Email or Nickname</label>
                    <input type="text" id="identifier" name="identifier" required>
                </div>
                <div class="input-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" name="password" required>
                </div>
                <button type="submit" class="btn">Login</button>
            </form>
            <p class="auth-switch">Don't have an account? <a class="btn-link" href="/register" data-link>Register</a></p>
        </div>
    `;

    if (notice) el('error-box').textContent = notice;
    el('login-form').addEventListener('submit', handleLogin);
}

export function renderRegister() {
    el('app').innerHTML = `
        <div class="auth-box card">
            <h2>Register</h2>
            <div id="error-box" class="error-msg"></div>
            <form id="register-form">
                <div class="input-group">
                    <label for="nickname">Nickname</label>
                    <input type="text" id="nickname" name="nickname" required>
                </div>
                <div class="input-group">
                    <label for="age">Age</label>
                    <input type="number" id="age" name="age" min="13" max="120" required>
                </div>
                <div class="input-group">
                    <label for="gender">Gender</label>
                    <select id="gender" name="gender">
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                    </select>
                </div>
                <div class="input-group">
                    <label for="first_name">First Name</label>
                    <input type="text" id="first_name" name="first_name" required>
                </div>
                <div class="input-group">
                    <label for="last_name">Last Name</label>
                    <input type="text" id="last_name" name="last_name" required>
                </div>
                <div class="input-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" name="email" required>
                </div>
                <div class="input-group">
                    <label for="reg-password">Password</label>
                    <input type="password" id="reg-password" name="password" minlength="8" required>
                </div>
                <button type="submit" class="btn">Register</button>
            </form>
            <p class="auth-switch">Already have an account? <a class="btn-link" href="/login" data-link>Login</a></p>
        </div>
    `;

    el('register-form').addEventListener('submit', handleRegister);
}

async function handleLogin(event) {
    event.preventDefault();
    const errorBox = el('error-box');
    clearError(errorBox);

    const data = Object.fromEntries(new FormData(event.target).entries());

    try {
        const response = await api.login(data);
        if (!response.ok) {
            showError(errorBox, await response.text());
            return;
        }
        await onLoggedIn();
    } catch (_) {
        showError(errorBox, 'Network error');
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const errorBox = el('error-box');
    clearError(errorBox);

    const data = Object.fromEntries(new FormData(event.target).entries());
    data.age = parseInt(data.age, 10) || 0;

    try {
        const response = await api.register(data);
        if (!response.ok) {
            showError(errorBox, await response.text());
            return;
        }
        setLoginNotice('Registration successful, you can log in now.');
        navigate('/login');
    } catch (_) {
        showError(errorBox, 'Network error');
    }
}
