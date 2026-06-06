document.getElementById('currentYear').textContent = new Date().getFullYear();
document.getElementById('regUserType').addEventListener('change', function () {
    const doctorFields = document.getElementById('doctorFields');
    doctorFields.style.display =
        (this.value === 'psychologue' || this.value === 'counselor') ? 'block' : 'none';
});

if (isLoggedIn()) {
    const user = getCurrentUser();
    if (user) {
        if (user.status === 'pending') {
            window.location.href = 'pending.html';
        } else {
            redirectByUserType(user.userType);
        }
    }
}


window.showLogin = function () {
    document.getElementById('login').classList.add('active');
    document.getElementById('register').classList.remove('active');
};

window.showRegister = function () {
    document.getElementById('login').classList.remove('active');
    document.getElementById('register').classList.add('active');
};

window.handleLogin = async function () {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        alert('Veuillez entrer votre email et mot de passe');
        return;
    }

    try {
        const result = await authAPI.login({ email, password });
        if (result.token) {
            localStorage.setItem('nebras_token', result.token);
        } else {
            alert('Erreur: Réponse de connexion invalide');
            return;
        }
        localStorage.setItem('nebras_user', JSON.stringify(result.user));

        // ✅ Block pending and rejected users
        if (result.user.status === 'pending') {
            window.location.href = 'pending.html';
            return;
        }
        if (result.user.status === 'rejected') {
            alert('Votre compte a été rejeté. Veuillez contacter l\'administration.');
            return;
        }
        if (result.user.status === 'suspended') {
            alert('Votre compte a été suspendu. Veuillez contacter l\'administration.');
            return;
        }

        setTimeout(() => redirectByUserType(result.user.userType), 300);
    } catch (e) {
        alert('Erreur: ' + e.message);
    }
};

window.handleRegister = async function () {
    const userType = document.getElementById('regUserType').value;
    const fullname = document.getElementById('regFullname').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('regConfirmPassword').value;
    const rules = document.getElementById('rules');

    if (!fullname || !email || !password) {
        alert('Veuillez remplir tous les champs');
        return;
    }
    if (password !== confirmPassword) {
        alert('Les mots de passe ne correspondent pas');
        return;
    }
    if (!rules.checked) {
        alert('Vous devez accepter les règles du site');
        return;
    }

    // Doctor-specific validation
    let agrement = null;
    let certificateBase64 = null;

    if (userType === 'psychologue' || userType === 'counselor') {
        agrement = document.getElementById('regAgrement').value.trim();
        if (!agrement) {
            alert('Le numéro d\'agrément est obligatoire');
            return;
        }

        const certFile = document.getElementById('regCertificate').files[0];
        if (!certFile) {
            alert('Veuillez uploader votre certificat');
            return;
        }

        // Convert to base64
        certificateBase64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Erreur de lecture du fichier'));
            reader.readAsDataURL(certFile);
        });
    }

    try {
        const result = await authAPI.register({
            email, password, fullname, userType,
            agrement: agrement || undefined,
            certificate: certificateBase64 || undefined
        });
        if (result.token) {
            localStorage.setItem('nebras_token', result.token);
        }
        localStorage.setItem('nebras_user', JSON.stringify(result.user));

        if (result.user.status === 'pending') {
            window.location.href = 'pending.html';
        } else {
            setTimeout(() => redirectByUserType(result.user?.userType || userType), 300);
        }
    } catch (e) {
        alert('Erreur: ' + e.message);
    }
};
window.goToHome = function () {
    window.location.href = 'home.html';
};
