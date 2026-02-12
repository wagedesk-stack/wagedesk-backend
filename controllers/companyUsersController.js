import supabase from "../libs/supabaseAdmin.js"
import { checkCompanyAccess } from "./employeeController.js";
import { sendEmailService } from "../services/email.js";
import bcrypt from "bcryptjs";

// Generate temporary password
const generateTemporaryPassword = () => {
  const year = new Date().getFullYear();
  const randomChars = Math.random().toString(36).slice(-4).toUpperCase();
  return `WageDesk@${year}${randomChars}`;
};

// Create auth user in Supabase
const createAuthUser = async (email, password, fullNames) => {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Auto-verify email
    user_metadata: { 
      user_name: fullNames,
      full_names: fullNames 
    },
  });

  if (error) throw error;
  return data.user;
};

// List company users
export const listCompanyUsers = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  // Check authorization
  const isAuthorized = await checkCompanyAccess(
    companyId,
    userId,
    "ORG_SETTINGS",
    "can_read"
  );

  if (!isAuthorized) {
    return res.status(403).json({
      error: "Unauthorized to view company users.",
    });
  }

  try {
    // Get company users with their workspace and auth details
    const { data: companyUsers, error: companyError } = await supabase
      .from("company_users")
      .select(`
        id,
        role,
        created_at,
        user_id,
        companies!inner(
          id,
          business_name,
          workspace_id
        )
      `)
      .eq("company_id", companyId);

    if (companyError) throw companyError;

    // Get workspace users for the same workspace
    const workspaceId = companyUsers[0]?.companies?.workspace_id;
    
    const { data: workspaceUsers, error: workspaceError } = await supabase
      .from("workspace_users")
      .select("user_id, role, full_names, email")
      .eq("workspace_id", workspaceId);

    if (workspaceError) throw workspaceError;

    // Get auth users metadata
    const userIds = companyUsers.map(cu => cu.user_id);
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
    
    if (authError) throw authError;

    // Merge all data
    const users = companyUsers.map(cu => {
      const workspaceUser = workspaceUsers.find(wu => wu.user_id === cu.user_id);
      const authUser = authUsers.users.find(au => au.id === cu.user_id);
      
      return {
        id: cu.user_id,
        company_user_id: cu.id,
        email: authUser?.email || workspaceUser?.email,
        full_names: workspaceUser?.full_names || authUser?.user_metadata?.full_names,
        role: cu.role,
        workspace_role: workspaceUser?.role,
        created_at: cu.created_at,
        status: authUser?.banned_until ? 'SUSPENDED' : 'ACTIVE',
        last_sign_in: authUser?.last_sign_in_at,
      };
    });

    res.json(users);
  } catch (error) {
    console.error("Error listing company users:", error);
    res.status(500).json({ error: "Failed to fetch company users" });
  }
};

// Add user to company
export const addCompanyUser = async (req, res) => {
  const { companyId } = req.params;
  const { email, full_names, role, send_email } = req.body;
  const userId = req.userId;

  // Validate required fields
  if (!email || !full_names || !role) {
    return res.status(400).json({ 
      error: "Email, full names, and role are required" 
    });
  }

  // Validate role
  const validRoles = ['ADMIN', 'MANAGER', 'VIEWER'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  // Check authorization
  const isAuthorized = await checkCompanyAccess(
    companyId,
    userId,
    "ORG_SETTINGS",
    "can_write"
  );

  if (!isAuthorized) {
    return res.status(403).json({
      error: "Unauthorized to add users to this company.",
    });
  }

  try {
    // Get company details
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id, business_name, workspace_id")
      .eq("id", companyId)
      .single();

    if (companyError || !company) {
      return res.status(404).json({ error: "Company not found" });
    }

    // Generate temporary password
    const temporaryPassword = generateTemporaryPassword();
    let authUser;
    let isExistingUser = false;

    // Check if user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers.users.find(u => u.email === email);

    if (existingUser) {
      authUser = existingUser;
      isExistingUser = true;
    } else {
      // Create new auth user
      authUser = await createAuthUser(email, temporaryPassword, full_names);
    }

    // Check if user is already in workspace
    const { data: existingWorkspaceUser } = await supabase
      .from("workspace_users")
      .select("id")
      .eq("workspace_id", company.workspace_id)
      .eq("user_id", authUser.id)
      .maybeSingle();

    if (!existingWorkspaceUser) {
      // Add to workspace_users
      const { error: workspaceError } = await supabase
        .from("workspace_users")
        .insert([{
          workspace_id: company.workspace_id,
          user_id: authUser.id,
          role: role, // Workspace role matches company role
          full_names,
          email,
        }]);

      if (workspaceError) throw workspaceError;
    }

    // Check if user is already in company
    const { data: existingCompanyUser } = await supabase
      .from("company_users")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", authUser.id)
      .maybeSingle();

    if (existingCompanyUser) {
      return res.status(400).json({ 
        error: "User is already a member of this company" 
      });
    }

    // Add to company_users
    const { data: companyUser, error: companyUserError } = await supabase
      .from("company_users")
      .insert([{
        company_id: companyId,
        user_id: authUser.id,
        role,
      }])
      .select()
      .single();

    if (companyUserError) throw companyUserError;

    // Prepare response with credentials
    const response = {
      success: true,
      user: {
        id: authUser.id,
        email,
        full_names,
        role,
        is_existing_user: isExistingUser,
      },
    };

    // Only include password for new users
    if (!isExistingUser) {
      response.user.temporary_password = temporaryPassword;
    }

    // Send email if requested
    if (send_email) {
      const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`;
      
      let emailBody = '';
      if (isExistingUser) {
        emailBody = `
          <p>You have been added to <strong>${company.business_name}</strong> on WageDesk with the role of <strong>${role}</strong>.</p>
          <p>You can continue using your existing account to access this company.</p>
          <p><a href="${loginUrl}" style="background-color: #1F3A8A; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px;">Login to WageDesk</a></p>
        `;
      } else {
        emailBody = `
          <p>You have been added to <strong>${company.business_name}</strong> on WageDesk with the role of <strong>${role}</strong>.</p>
          <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0;"><strong>Login credentials:</strong></p>
            <p style="margin: 0 0 4px 0;">Email: <strong>${email}</strong></p>
            <p style="margin: 0 0 4px 0;">Temporary password: <strong>${temporaryPassword}</strong></p>
            <p style="margin: 8px 0 0 0; font-size: 14px; color: #4b5563;">You'll be prompted to change this password on first login.</p>
          </div>
          <p><a href="${loginUrl}" style="background-color: #1F3A8A; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px;">Login to WageDesk</a></p>
        `;
      }

      await sendEmailService({
        to: email,
        subject: `You've been added to ${company.business_name} on WageDesk`,
        html: `
          <div style="font-family: sans-serif; color: #334155; line-height: 1.6;">
            <h2 style="color: #0f172a;">Welcome to WageDesk</h2>
            ${emailBody}
            <p style="font-size: 12px; color: #94a3b8; margin-top: 30px;">
              This is an automated message from WageDesk.
            </p>
          </div>
        `,
        text: `You've been added to ${company.business_name} on WageDesk. Login at ${loginUrl}`,
        company: company.business_name,
      });

      response.email_sent = true;
    }

    res.status(201).json(response);
  } catch (error) {
    console.error("Error adding company user:", error);
    res.status(500).json({ error: "Failed to add user to company" });
  }
};

// Update user role
export const updateCompanyUserRole = async (req, res) => {
  const { companyId, userId: targetUserId } = req.params;
  const { role } = req.body;
  const currentUserId = req.userId;

  // Validate role
  const validRoles = ['ADMIN', 'MANAGER', 'VIEWER'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  // Check authorization
  const isAuthorized = await checkCompanyAccess(
    companyId,
    currentUserId,
    "ORG_SETTINGS",
    "can_approve"
  );

  if (!isAuthorized) {
    return res.status(403).json({
      error: "Unauthorized to update user roles.",
    });
  }

  try {
    // Cannot change your own role
    if (targetUserId === currentUserId) {
      return res.status(400).json({ 
        error: "You cannot change your own role" 
      });
    }

    // Update company_users role
    const { data, error } = await supabase
      .from("company_users")
      .update({ role })
      .eq("company_id", companyId)
      .eq("user_id", targetUserId)
      .select()
      .single();

    if (error) throw error;

    // Also update workspace_users role to match
    const { data: company } = await supabase
      .from("companies")
      .select("workspace_id")
      .eq("id", companyId)
      .single();

    if (company) {
      await supabase
        .from("workspace_users")
        .update({ role })
        .eq("workspace_id", company.workspace_id)
        .eq("user_id", targetUserId);
    }

    res.json({
      success: true,
      user: {
        id: targetUserId,
        role: data.role,
      },
    });
  } catch (error) {
    console.error("Error updating user role:", error);
    res.status(500).json({ error: "Failed to update user role" });
  }
};

// Remove user from company
export const removeCompanyUser = async (req, res) => {
  const { companyId, userId: targetUserId } = req.params;
  const currentUserId = req.userId;

  // Check authorization
  const isAuthorized = await checkCompanyAccess(
    companyId,
    currentUserId,
    "ORG_SETTINGS",
    "can_delete"
  );

  if (!isAuthorized) {
    return res.status(403).json({
      error: "Unauthorized to remove users from this company.",
    });
  }

  try {
    // Cannot remove yourself
    if (targetUserId === currentUserId) {
      return res.status(400).json({ 
        error: "You cannot remove yourself from the company" 
      });
    }

    // Remove from company_users
    const { error: companyError } = await supabase
      .from("company_users")
      .delete()
      .eq("company_id", companyId)
      .eq("user_id", targetUserId);

    if (companyError) throw companyError;

    // Check if user is in any other companies in this workspace
    const { data: company } = await supabase
      .from("companies")
      .select("workspace_id")
      .eq("id", companyId)
      .single();

    if (company) {
      const { data: otherCompanies } = await supabase
        .from("companies")
        .select("id")
        .eq("workspace_id", company.workspace_id);

      const { data: otherCompanyUsers } = await supabase
        .from("company_users")
        .select("id")
        .eq("user_id", targetUserId)
        .in("company_id", otherCompanies.map(c => c.id));

      // If user has no other companies in this workspace, remove from workspace_users
      if (!otherCompanyUsers || otherCompanyUsers.length === 0) {
        await supabase
          .from("workspace_users")
          .delete()
          .eq("workspace_id", company.workspace_id)
          .eq("user_id", targetUserId);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error removing company user:", error);
    res.status(500).json({ error: "Failed to remove user from company" });
  }
};

// Suspend/Unsuspend user
export const toggleUserSuspension = async (req, res) => {
  const { companyId, userId: targetUserId } = req.params;
  const { suspend } = req.body;
  const currentUserId = req.userId;

  // Check authorization
  const isAuthorized = await checkCompanyAccess(
    companyId,
    currentUserId,
    "ORG_SETTINGS",
    "can_approve"
  );

  if (!isAuthorized) {
    return res.status(403).json({
      error: "Unauthorized to suspend users.",
    });
  }

  try {
    // Cannot suspend yourself
    if (targetUserId === currentUserId) {
      return res.status(400).json({ 
        error: "You cannot suspend your own account" 
      });
    }

    if (suspend) {
      // Suspend user
      await supabase.auth.admin.updateUserById(targetUserId, {
        ban_duration: '876000h', // 100 years
      });
    } else {
      // Unsuspend user
      await supabase.auth.admin.updateUserById(targetUserId, {
        ban_duration: '0s',
      });
    }

    res.json({ 
      success: true, 
      suspended: suspend 
    });
  } catch (error) {
    console.error("Error toggling user suspension:", error);
    res.status(500).json({ error: "Failed to update user status" });
  }
};

// Reset user password
export const resetUserPassword = async (req, res) => {
  const { companyId, userId: targetUserId } = req.params;
  const { send_email } = req.body;
  const currentUserId = req.userId;

  // Check authorization
  const isAuthorized = await checkCompanyAccess(
    companyId,
    currentUserId,
    "ORG_SETTINGS",
    "can_approve"
  );

  if (!isAuthorized) {
    return res.status(403).json({
      error: "Unauthorized to reset user passwords.",
    });
  }

  try {
    const temporaryPassword = generateTemporaryPassword();

    // Update user password
    await supabase.auth.admin.updateUserById(targetUserId, {
      password: temporaryPassword,
    });

    // Get user details
    const { data: user } = await supabase.auth.admin.getUserById(targetUserId);
    const { data: companyUser } = await supabase
      .from("company_users")
      .select("companies(business_name)")
      .eq("company_id", companyId)
      .eq("user_id", targetUserId)
      .single();

    const response = {
      success: true,
      temporary_password: temporaryPassword,
    };

    // Send email if requested
    if (send_email) {
      const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`;
      
      await sendEmailService({
        to: user.user.email,
        subject: `Your WageDesk password has been reset`,
        html: `
          <div style="font-family: sans-serif; color: #334155; line-height: 1.6;">
            <h2 style="color: #0f172a;">Password Reset</h2>
            <p>Your password for <strong>${companyUser.companies.business_name}</strong> on WageDesk has been reset.</p>
            <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0 0 8px 0;"><strong>New temporary password:</strong></p>
              <p style="margin: 0 0 4px 0;"><strong>${temporaryPassword}</strong></p>
              <p style="margin: 8px 0 0 0; font-size: 14px; color: #4b5563;">You'll be prompted to change this password on next login.</p>
            </div>
            <p style="font-size: 12px; color: #94a3b8; margin-top: 30px;">
              This is an automated message from WageDesk.
            </p>
          </div>
        `,
        text: `Your WageDesk password has been reset. New password: ${temporaryPassword}`,
        company: companyUser.companies.business_name,
      });

      response.email_sent = true;
    }

    res.json(response);
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
};

// Send login credentials email
export const sendCredentialsEmail = async (req, res) => {
  const { companyId, userId: targetUserId } = req.params;
  const currentUserId = req.userId;

  // Check authorization
  const isAuthorized = await checkCompanyAccess(
    companyId,
    currentUserId,
    "ORG_SETTINGS",
    "can_read"
  );

  if (!isAuthorized) {
    return res.status(403).json({
      error: "Unauthorized to send credentials.",
    });
  }

  try {
    // Get user details
    const { data: user } = await supabase.auth.admin.getUserById(targetUserId);
    const { data: companyUser } = await supabase
      .from("company_users")
      .select("companies(business_name), role")
      .eq("company_id", companyId)
      .eq("user_id", targetUserId)
      .single();

    const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`;
    
    await sendEmailService({
      to: user.user.email,
      subject: `Access to ${companyUser.companies.business_name} on WageDesk`,
      html: `
        <div style="font-family: sans-serif; color: #334155; line-height: 1.6;">
          <h2 style="color: #0f172a;">WageDesk Access</h2>
          <p>You have access to <strong>${companyUser.companies.business_name}</strong> on WageDesk with the role of <strong>${companyUser.role}</strong>.</p>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 30px;">
            This is an automated message from WageDesk.
          </p>
        </div>
      `,
      text: `You have access to ${companyUser.companies.business_name} on WageDesk.`,
      company: companyUser.companies.business_name,
    });

    res.json({ success: true, email_sent: true });
  } catch (error) {
    console.error("Error sending credentials email:", error);
    res.status(500).json({ error: "Failed to send credentials email" });
  }
};