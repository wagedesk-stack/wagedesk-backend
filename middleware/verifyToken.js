import supabase from "../libs/supabaseClient.js";

export default async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") 
    ? authHeader.split(" ")[1] 
    : req.query.token;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ error: "Session expired or invalid" });
    }

    req.user = data.user;
    req.userId = data.user.id;

    // Optional: Add a sharp logging detail for your professional console
    console.log(`[Auth]: ${data.user.email} accessing ${req.path}`);
    
    next();
  } catch (error) {
    console.error('Auth Error:', error.message);
    res.status(500).json({ error: 'Internal server authentication error' });
  }
}