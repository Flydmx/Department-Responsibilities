async function renderNav() {
    const token = localStorage.getItem('token');
    const navList = document.getElementById('nav-list');

    const userResponse = await fetch('http://10.7.209.28:3001/api/profile', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!userResponse.ok) throw new Error('获取用户信息失败');
    const user = await userResponse.json();

    const role = user.role;

    if (token) {
        if (role === 'super_admin' ) { // 假设这些是管理员角色
            navList.innerHTML = `
                <ul>
                    <li><a href="admin.html">网站管理</a></li>
                    <li><a href="departments.html">部门职责</a></li>
                    <li><a href="logout.html">退出登录</a></li>
                </ul>
            `;
        } else { // 非管理员角色，例如 'employee'
            navList.innerHTML = `
                <ul>
                    <li><a href="departments.html">部门职责</a></li>
                    <li><a href="profile.html">个人信息</a></li>
                    <li><a href="logout.html">退出登录</a></li>
                </ul>
            `;
        }
    } else {
        navList.innerHTML = `
            <ul>
                <li><a href="login.html">登录</a></li>
                <li><a href="register.html">注册</a></li>
            </ul>
        `;
    }
}
document.addEventListener('DOMContentLoaded', function () {
    renderNav(); // 页面加载时渲染导航栏
});