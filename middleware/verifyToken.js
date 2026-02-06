import supabase from "../libs/supabaseClient.js";

export default async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1] || req.query.token;

  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    // Verify the token with the Supabase auth service
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Attach the user ID to the request object
    req.userId = data.user.id;
    req.user = data.user;
    next();
  } catch (error) {
     console.error('Token verification failed:', error);
    res.status(500).json({ error: 'Authentication failed.' });
  }
}
