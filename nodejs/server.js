const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config(); // 用于读取环境变量

const app = express();
app.use(cors());
app.use(bodyParser.json());

module.exports = app; // ✅ 只导出 app，不调用 app.listen

// 数据库连接池配置
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'department_system',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// JWT 密钥（通过环境变量配置）
const JWT_SECRET = process.env.JWT_SECRET || 'Jyndiablo';

// ----------------------------
// 用户认证相关 API
// ----------------------------

// 用户登录
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) return res.status(801).json({ error: '用户不存在' });

    const isValid = await bcrypt.compare(password, rows[0].password);
    if (!isValid) return res.status(802).json({ error: '密码错误' });

    const token = jwt.sign(
      { username, role: rows[0].role, department: rows[0].department_id },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// 用户注册
app.post('/api/register', async (req, res) => {
  const { username, password, role, department } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password, role, department_id) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, role, department]
    );
    res.json({ message: '注册成功' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: '用户名已存在' });
    } else {
      res.status(500).json({ error: '服务器错误' });
    }
  }
});

// ----------------------------
// 中间件：JWT 验证
// ----------------------------
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '未提供令牌' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: '令牌无效' });
  }
};

// ----------------------------
// 部门管理相关 API
// ----------------------------

// 获取所有部门（分类后）
app.get('/api/departments', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM departments');
    const classified = {
      '经营单位': { '区局': [], '行业大客户部': [], '经营责任类': [] },
      '非经营单位': { '运营支撑类': [], '运营统筹类': [], '综合管理类': [], '集团委托管理类': [] }
    };

    rows.forEach(dept => {
      const category = dept.category;
      const subcategory = dept.subcategory;
      if (classified[category] && classified[category][subcategory]) {
        classified[category][subcategory].push({
          id: dept.id,
          name: dept.name,
          abbr: dept.abbreviation || '无'
        });
      }
    });

    res.json(classified);
  } catch (error) {
    res.status(500).json({ error: '获取部门数据失败' });
  }
});

// 添加部门
app.post('/api/departments', async (req, res) => {
  const { id, name, abbreviation, category, subcategory } = req.body;
  try {
    await pool.query(
      'INSERT INTO departments (id, name, abbreviation, category, subcategory) VALUES (?, ?, ?, ?, ?)',
      [id, name, abbreviation, category, subcategory]
    );
    res.json({ message: '部门添加成功' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: '部门ID已存在' });
    } else {
      res.status(500).json({ error: '服务器错误' });
    }
  }
});

app.delete('/api/departments/:id', authenticate, async (req, res) => {
  const deptId = req.params.id;
  try {
    await pool.query('DELETE FROM departments WHERE id = ?', [deptId]);
    res.json({ message: '部门删除成功' });
  } catch (error) {
    res.status(500).json({ error: '删除失败' });
  }
});

// 新增 API：根据部门 ID 返回部门名称
app.get('/api/departments/:id/name', async (req, res) => {
  const deptId = req.params.id;
  try {
    const [rows] = await pool.query('SELECT name FROM departments WHERE id = ?', [deptId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '部门不存在' });
    }
    res.json({ department_name: rows[0].name });
  } catch (error) {
    res.status(500).json({ error: '获取部门名称失败' });
  }
});


// ----------------------------
// 职责管理相关 API
// ----------------------------

// 获取部门职责详情
app.get('/api/departments/:id/responsibilities', async (req, res) => {
  const deptId = req.params.id;
  try {
    const [rows] = await pool.query(
      'SELECT * FROM responsibilities WHERE department_id = ?',
      [deptId]
    );
    res.json(rows.map(row => ({
      id: row.id,
      description: row.description,
      explanation: row.explanation || '',
      tasks: row.tasks ? row.tasks.split('\n').map(taskStr => {
        const [taskDesc, reg] = taskStr.split(' - ').map(s => s.trim());
        return {
          task_description: taskDesc || '',
          regulation: reg || ''
        };
      }) : [],
      regulations: row.regulations || ''
    })));
  } catch (error) {
    res.status(500).json({ error: '获取职责数据失败' });
  }
});

// 更新部门职责
app.put('/api/departments/:id/responsibilities', async (req, res) => {
  const deptId = req.params.id;
  const responsibilities = req.body;

  // 开启事务
  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // 删除旧职责
    await conn.query('DELETE FROM responsibilities WHERE department_id = ?', [deptId]);

    // 插入新职责
    for (const resp of responsibilities) {
      await conn.query(
        'INSERT INTO responsibilities (department_id, description, explanation, tasks, regulations) VALUES (?, ?, ?, ?, ?)',
        [deptId, resp.description, resp.explanation, resp.tasks.join('\n'), resp.regulations]
      );
    }

    await conn.commit();
    res.json({ message: '职责更新成功' });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: '更新失败' });
  } finally {
    conn.release();
  }
});

// ----------------------------
// 用户个人信息 API
// ----------------------------
// 获取用户信息
app.get('/api/profile', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT username, role, department_id FROM users WHERE username = ?', [req.user.username]);
    const user = rows[0];
    if (user.department_id) {
      const [deptRows] = await pool.query('SELECT name FROM departments WHERE id = ?', [user.department_id]);
      user.department_name = deptRows[0]?.name || '未知';
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

// 更新用户信息
app.put('/api/profile', authenticate, async (req, res) => {
  const { username, password, department } = req.body;
  try {
    const updates = {};
    if (username) updates.username = username;
    if (password) updates.password = await bcrypt.hash(password, 10);
    if (department !== undefined) updates.department_id = department;

    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(req.user.username);

    await pool.query(`UPDATE users SET ${fields} WHERE username = ?`, values);
    res.json({ message: '更新成功' });
  } catch (error) {
    res.status(500).json({ error: '更新失败' });
  }
});


// ----------------------------
// 用户管理相关 API（仅超级管理员）
// ----------------------------

// 获取所有用户
app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT username, role, department_id FROM users');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: '获取用户数据失败' });
  }
});

// 删除用户
app.delete('/api/users/:username', async (req, res) => {
  const username = req.params.username;
  try {
    await pool.query('DELETE FROM users WHERE username = ?', [username]);
    res.json({ message: '用户删除成功' });
  } catch (error) {
    res.status(500).json({ error: '删除失败' });
  }
});



async function testDatabaseConnection() {
  try {
    // 尝试连接数据库
    const connection = await pool.getConnection();
    console.log('数据库连接成功');
    connection.release(); // 释放连接池中的连接
  } catch (error) {
    console.error('数据库连接失败:', error.message);
    process.exit(1); // 连接失败时退出应用
  }
}

// 调用数据库连接测试
testDatabaseConnection();

