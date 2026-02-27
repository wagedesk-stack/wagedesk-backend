// backend/controllers/payrollCompareController.js
import supabase from "../libs/supabaseClient.js";

export const comparePayrollRuns = async (req, res) => {
  const { companyId, runId1, runId2 } = req.params;

  try {
    // Fetch both payroll runs with their details
   const [run1Response, run2Response] = await Promise.all([
      supabase.from("payroll_runs").select(`*`).eq("id", runId1).single(),
      supabase.from("payroll_runs").select(`*`).eq("id", runId2).single()
    ]);

    if (run1Response.error || !run1Response.data) throw new Error("Current run not found");
    if (run2Response.error || !run2Response.data) throw new Error("Comparison run not found");

    const r1 = run1Response.data;
    const r2 = run2Response.data;

    // Helper to prevent Division by Zero
    const calcChange = (current, previous) => {
      if (!previous || previous === 0) return 0;
      return Number(((current - previous) / previous * 100).toFixed(1));
    };

    // Fetch department breakdown for both runs
    const [dept1Response, dept2Response] = await Promise.all([
      supabase
        .from("payroll_details")
        .select(`
          net_pay,
          employees (
            departments ( name )
          )
        `)
        .eq("payroll_run_id", runId1),
      
      supabase
        .from("payroll_details")
        .select(`
          net_pay,
          employees (
            departments ( name )
          )
        `)
        .eq("payroll_run_id", runId2)
    ]);

    // Calculate department breakdown
    const deptMap = new Map();
    
    // Process run1 data
    dept1Response.data?.forEach(item => {
      const deptName = item.employees?.departments?.name || "Unassigned";
      if (!deptMap.has(deptName)) {
        deptMap.set(deptName, { currentNet: 0, previousNet: 0 });
      }
      deptMap.get(deptName).currentNet += Number(item.net_pay);
    });

    // Process run2 data
    dept2Response.data?.forEach(item => {
      const deptName = item.employees?.departments?.name || "Unassigned";
      if (!deptMap.has(deptName)) {
        deptMap.set(deptName, { currentNet: 0, previousNet: 0 });
      }
      deptMap.get(deptName).previousNet += Number(item.net_pay);
    });

    // Calculate changes and format department breakdown
    const departmentBreakdown = Array.from(deptMap.entries()).map(([dept, values]) => ({
      department: dept,
      currentNet: values.currentNet,
      previousNet: values.previousNet,
      change: values.previousNet > 0 
        ? Number(((values.currentNet - values.previousNet) / values.previousNet * 100).toFixed(1))
        : 0
    }));

    // Calculate differences
    const differences = {
      grossChange: calcChange(r1.total_gross_pay, r2.total_gross_pay),
      netChange: calcChange(r1.total_net_pay, r2.total_net_pay),
      // Avg per employee calculation fix
      avgChange: calcChange(
        (r1.total_net_pay / r1.employee_count), 
        (r2.total_net_pay / r2.employee_count)
      ),
      countChange: r1.employee_count - r2.employee_count
    };

    const comparisonData = {
      current: {
        totalGross: run1Response.data.total_gross_pay,
        totalNet: run1Response.data.total_net_pay,
        avgPerEmployee: run1Response.data.total_net_pay / run1Response.data.employee_count,
        employeeCount: run1Response.data.employee_count
      },
      previous: {
        totalGross: run2Response.data.total_gross_pay,
        totalNet: run2Response.data.total_net_pay,
        avgPerEmployee: run2Response.data.total_net_pay / run2Response.data.employee_count,
        employeeCount: run2Response.data.employee_count
      },
      differences,
      departmentBreakdown
    };

    res.status(200).json(comparisonData);
 } catch (error) {
    console.error("Comparison Error:", error); // Log to server console
    res.status(500).json({ error: error.message });
  }
};