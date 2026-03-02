// backend/controllers/payrollController.js
import supabase from "../libs/supabaseAdmin.js";
import { v4 as uuidv4 } from "uuid";

// --- Constants ---
const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DISABILITY_EXEMPTION = 150000; // Annual tax exemption for PWDs
const INSURANCE_RELIEF_CAP = 5000;
const PERSONAL_RELIEF = 2400;
const MEAL_EXEMPTION_LIMIT = 5000;

// Helper to get date from month/year
const getMonthEndDate = (month, year) => {
  return new Date(year, monthNames.indexOf(month) + 1, 0);
};
// Helper to compare month/year with payroll period
const isInPayrollPeriod = (
  startMonth,
  startYear,
  endMonth,
  endYear,
  targetMonth,
  targetYear,
) => {
  const targetMonthIndex = monthNames.indexOf(targetMonth);
  const startMonthIndex = monthNames.indexOf(startMonth);

  // Convert to comparable numbers (year * 12 + month index)
  const targetValue = targetYear * 12 + targetMonthIndex;
  const startValue = startYear * 12 + startMonthIndex;

  // Check if target is after or equal to start
  if (targetValue < startValue) return false;

  // If no end date (recurring), it's valid
  if (!endMonth || !endYear) return true;

  const endMonthIndex = monthNames.indexOf(endMonth);
  const endValue = endYear * 12 + endMonthIndex;

  // Check if target is before or equal to end
  return targetValue <= endValue;
};

// Helper to check if employee was active during payroll period
const isEmployeeActiveDuringPeriod = (employee, payrollMonth, payrollYear) => {
  const payrollEndDate = getMonthEndDate(payrollMonth, payrollYear);
  const hireDate = new Date(employee.hire_date);

  // Must be hired on or before payroll period end
  if (hireDate > payrollEndDate) return false;

  // Check contract end date if exists
  if (employee.employee_contracts?.end_date) {
    const contractEndDate = new Date(employee.employee_contracts.end_date);
    if (contractEndDate < payrollEndDate) return false;
  }

  // Check status effective date for exclusions
  if (employee.employee_status_effective_date) {
    const statusEffectiveDate = new Date(
      employee.employee_status_effective_date,
    );
    const excludedStatuses = ["TERMINATED", "SUSPENDED", "RETIRED"];

    if (excludedStatuses.includes(employee.employee_status)) {
      if (statusEffectiveDate <= payrollEndDate) return false;
    }
  }

  return true;
};

// --- Statutory Calculation Functions ---
const calculatePAYE = (taxableIncome, isDisabled = false) => {
  let annualTaxableIncome = taxableIncome * 12;
  let annualTax = 0;

  // Apply disability exemption if applicable (annual)
  if (isDisabled) {
    annualTaxableIncome = Math.max(
      0,
      annualTaxableIncome - DISABILITY_EXEMPTION,
    );
  }

  // Monthly bands
  if (annualTaxableIncome <= 288000) {
    // 24,000 * 12
    annualTax = annualTaxableIncome * 0.1;
  } else if (annualTaxableIncome <= 388000) {
    // 32,333 * 12
    annualTax = 28800 + (annualTaxableIncome - 288000) * 0.25;
  } else if (annualTaxableIncome <= 6000000) {
    // 500,000 * 12
    annualTax = 28800 + 25000 + (annualTaxableIncome - 388000) * 0.3;
  } else if (annualTaxableIncome <= 9600000) {
    // 800,000 * 12
    annualTax =
      28800 + 25000 + 1683600 + (annualTaxableIncome - 6000000) * 0.325;
  } else {
    annualTax =
      28800 +
      25000 +
      1683600 +
      1170000 +
      (annualTaxableIncome - 9600000) * 0.35;
  }

  // Convert to monthly and apply personal relief
  let monthlyTax = annualTax / 12;
  let finalTax = monthlyTax - PERSONAL_RELIEF;

  return Math.ceil(Math.max(0, finalTax));
};

const calculateNSSF = (
  pensionablePay,
  payrollMonth,
  payrollYear,
  employeeType,
) => {
  const payrollMonthIndex = monthNames.indexOf(payrollMonth);
  let tier1_cap, tier2_cap;
  const nssf_rate = 0.06;

  // Consultants don't pay NSSF through payroll
  if (employeeType === "Consultant") return { tier1: 0, tier2: 0, total: 0 };

  // Date-based caps
  if (payrollYear > 2026 || (payrollYear === 2026 && payrollMonthIndex >= 1)) {
    tier1_cap = 9000;
    tier2_cap = 108000;
  } else {
    tier1_cap = 8000;
    tier2_cap = 72000;
  }

  // Adjust caps based on employee type
  if (employeeType === "SECONDARY") {
    tier1_cap = Math.min(tier1_cap, 4500);
    tier2_cap = Math.min(tier2_cap, 45000);
  }

  let tier1_deduction = Math.min(pensionablePay, tier1_cap) * nssf_rate;
  let tier2_deduction = 0;

  if (pensionablePay > tier1_cap) {
    tier2_deduction =
      Math.min(pensionablePay - tier1_cap, tier2_cap - tier1_cap) * nssf_rate;
  }

  return {
    tier1: tier1_deduction,
    tier2: tier2_deduction,
    total: tier1_deduction + tier2_deduction,
  };
};

const calculateSHIF = (grossSalary, payrollYear, payrollMonth) => {
  const payrollMonthIndex = monthNames.indexOf(payrollMonth);

  // SHIF effective from 1 October 2024
  if (payrollYear < 2024 || (payrollYear === 2024 && payrollMonthIndex < 9)) {
    // October is index 9
    return 0; // No SHIF before October 2024
  }

  return Math.round(grossSalary * 0.0275);
};

const calculateHousingLevy = (grossSalary, payrollYear, payrollMonth) => {
  const payrollMonthIndex = monthNames.indexOf(payrollMonth);

  // Housing Levy effective from 19 March 2024
  // For simplicity, we'll apply from April 2024 onwards
  if (payrollYear < 2024 || (payrollYear === 2024 && payrollMonthIndex < 3)) {
    // April is index 3
    return 0; // No Housing Levy before April 2024
  }
  return Math.round(grossSalary * 0.015);
};

// --- Non-Cash Benefit Calculations ---
const calculateCarBenefit = (carValue) => {
  // Simplified car benefit calculation (2% of car value per month)
  return carValue * 0.02;
};

const calculateMealBenefit = (mealValue) => {
  if (mealValue <= MEAL_EXEMPTION_LIMIT) return 0;
  return mealValue - MEAL_EXEMPTION_LIMIT;
};

const calculateHousingBenefit = (
  houseValue,
  grossPay,
  housingType = "ORDINARY",
) => {
  const fifteenPercentGross = grossPay * 0.15;
  if (housingType === "FARM") {
    // Farm housing might have different calculation rules
    // This is a simplified approach - consult tax expert for exact farm housing rules
    return Math.max(fifteenPercentGross * 0.8, houseValue * 0.7);
  }

  return Math.max(fifteenPercentGross, houseValue);
};

const calculateOtherNonCashBenefit = (benefitValue) => {
  // For other non-cash benefits (not specifically categorized as CAR, MEAL, HOUSING)
  // The first 5000 is exempt, the rest is taxable
  if (benefitValue <= 5000) return 0;
  return benefitValue; // Tax the entire amount if it exceeds the limit
};

// --- Main Payroll Functions ---
export const syncPayroll = async (req, res) => {
  const { companyId } = req.params;
  const { month: payrollMonth, year: payrollYear } = req.body;
  const userId = req.userId;

  if (!payrollMonth || !payrollYear) {
    return res.status(400).json({ error: "Month and year are required." });
  }

  // Validate month
  if (!monthNames.includes(payrollMonth)) {
    return res.status(400).json({ 
      error: `Invalid month. Must be one of: ${monthNames.join(', ')}` 
    });
  }

  // Start a transaction
  const { data: transaction, error: txError } =
    await supabase.rpc("begin_transaction");

  try {
    // 1. Check for existing payroll run
    const { data: existingRun } = await supabase
      .from("payroll_runs")
      .select("id, status, payroll_number")
      .eq("company_id", companyId)
      .eq("payroll_month", payrollMonth)
      .eq("payroll_year", payrollYear)
      .maybeSingle();

    let payrollRunId = existingRun?.id;
    const isNewRun = !existingRun;

    // 2. Generate payroll number if new run
    if (isNewRun) {
      const { count } = await supabase
        .from("payroll_runs")
        .select("*", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("payroll_month", payrollMonth)
        .eq("payroll_year", payrollYear);

      const payrollCount = count || 0;
      const monthNum = String(monthNames.indexOf(payrollMonth) + 1).padStart(
        2,
        "0",
      );
      const sequence = String(payrollCount + 1).padStart(3, "0");
      const payrollNumber = `PR-${payrollYear}${monthNum}-${sequence}`;

      // Create new payroll run
      const newRunId = uuidv4();
      const { error: createError } = await supabase
        .from("payroll_runs")
        .insert({
          id: newRunId,
          company_id: companyId,
          payroll_number: payrollNumber,
          payroll_month: payrollMonth,
          payroll_year: payrollYear,
          payroll_date: new Date().toISOString().split("T")[0],
          status: "DRAFT",
          created_at: new Date().toISOString(),
        });

      if (createError) throw createError;
      payrollRunId = newRunId;
    }

    // 3. Delete existing records in correct order
    if (!isNewRun) {
      // First, get all payroll details for this run
      const { data: existingDetails } = await supabase
        .from("payroll_details")
        .select("id")
        .eq("payroll_run_id", payrollRunId);

      if (existingDetails && existingDetails.length > 0) {
        const detailIds = existingDetails.map((d) => d.id);

        // Delete reviews first (due to foreign key)
        const { error: deleteReviewsError } = await supabase
          .from("payroll_reviews")
          .delete()
          .in("payroll_detail_id", detailIds);

        if (deleteReviewsError) throw deleteReviewsError;

        // Then delete payroll details
        const { error: deleteDetailsError } = await supabase
          .from("payroll_details")
          .delete()
          .eq("payroll_run_id", payrollRunId);

        if (deleteDetailsError) throw deleteDetailsError;
      }
    }

    // 3. Fetch employees with all necessary relations
    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select(
        `
        *,
        employee_contracts!inner (
          id,
          contract_type,
          start_date,
          end_date,
          contract_status
        ),
        employee_payment_details (
          payment_method,
          bank_name,
          bank_code,
          branch_name,
          branch_code,
          account_number,
          account_name,
          mobile_type,
          phone_number
        ),
        helb_accounts (
          id,
          helb_account_number,
          monthly_deduction,
          current_balance,
          status
        )
      `,
      )
      .eq("company_id", companyId)
      .eq("employee_contracts.contract_status", "ACTIVE");

    if (employeesError) throw new Error("Failed to fetch employees.");

    // 4. Filter eligible employees
    const eligibleEmployees = employees.filter((emp) =>
      isEmployeeActiveDuringPeriod(emp, payrollMonth, payrollYear),
    );

    if (eligibleEmployees.length === 0) {
      return res.status(404).json({
        message: "No eligible employees found for this payroll period.",
      });
    }

    // 5. Fetch allowances and deductions with their types
    const [allowancesResult, deductionsResult, absentDaysResult] =
      await Promise.all([
        supabase
          .from("allowances")
          .select(
            `
          *,
          allowance_types!inner (
            code,
            name,
            is_cash,
            is_taxable,
            has_maximum_value,
            maximum_value
          )
        `,
          )
          .eq("company_id", companyId)
          .or(`is_recurring.eq.true,is_recurring.eq.false`),

        supabase
          .from("deductions")
          .select(
            `
          *,
          deduction_types!inner (
            code,
            name,
            is_pre_tax,
            has_maximum_value,
            maximum_value
          )
        `,
          )
          .eq("company_id", companyId)
          .or(`is_recurring.eq.true,is_recurring.eq.false`),

        supabase
          .from("employee_absent_days")
          .select("*")
          .eq("company_id", companyId)
          .eq("month", monthNames.indexOf(payrollMonth) + 1) // Convert month name to number
          .eq("year", payrollYear),
      ]);

    if (allowancesResult.error) throw new Error("Failed to fetch allowances.");
    if (deductionsResult.error) throw new Error("Failed to fetch deductions.");
    if (absentDaysResult.error) throw new Error("Failed to fetch absent days.");

     // Filter allowances and deductions in memory based on month/year
    const allAllowances = allowancesResult.data.filter(allowance => 
      isInPayrollPeriod(
        allowance.start_month,
        allowance.start_year,
        allowance.end_month,
        allowance.end_year,
        payrollMonth,
        payrollYear
      )
    );

    const allDeductions = deductionsResult.data.filter(deduction => 
      isInPayrollPeriod(
        deduction.start_month,
        deduction.start_year,
        deduction.end_month,
        deduction.end_year,
        payrollMonth,
        payrollYear
      )
    );
    const absentDaysRecords = absentDaysResult.data || [];

    // Create a map of absent days for quick lookup
    const absentDaysMap = new Map();
    absentDaysRecords.forEach((record) => {
      absentDaysMap.set(record.employee_id, {
        days: record.absent_days,
        amount: record.total_deduction_amount,
        notes: record.notes,
      });
    });

    // 7. Calculate payroll for each employee
    const payrollDetailsToInsert = [];
    let totals = {
      totalGrossPay: 0,
      totalStatutoryDeductions: 0,
      totalPaye: 0,
      totalNetPay: 0,
      totalNSSF: 0,
      totalSHIF: 0,
      totalHousingLevy: 0,
      totalHELB: 0,
    };

    for (const employee of eligibleEmployees) {
      // Get employee type from contract
      const employeeType = employee.employee_type || "Primary Employee";
      const isDisabled = employee.has_disability || false;

      // Basic salary
      let basicSalary = parseFloat(employee.salary);

      // Check for absent days
      let absentDaysDeduction = 0;
      let absentDaysCount = 0;
      const absentRecord = absentDaysMap.get(employee.id);
      if (absentRecord) {
        absentDaysCount = absentRecord.days;
        absentDaysDeduction = absentRecord.amount;

        // Adjust basic salary before statutory calculations
        basicSalary = basicSalary - absentDaysDeduction;
      }

      // Cash allowances and non-cash benefits
      let cashAllowances = 0;
      let nonCashTaxableBenefits = 0;
      let allowancesDetails = [];

      // Process allowances
      const employeeAllowances = allAllowances.filter(
        (a) =>
          a.employee_id === employee.id ||
          (a.employee_id === null &&
            a.department_id === employee.department_id) ||
          a.applies_to === "COMPANY",
      );

      for (const allowance of employeeAllowances) {
        let allowanceValue = 0;

        if (allowance.calculation_type === "FIXED") {
          allowanceValue = parseFloat(allowance.value);
        } else if (allowance.calculation_type === "PERCENTAGE") {
          allowanceValue = basicSalary * (parseFloat(allowance.value) / 100);
        }

        // Apply maximum value constraint
        if (allowance.allowance_types.has_maximum_value) {
          allowanceValue = Math.min(
            allowanceValue,
            allowance.allowance_types.maximum_value,
          );
        }

        const allowanceCode = allowance.allowance_types.code;
        const isCash = allowance.allowance_types.is_cash;

        // Categorize allowances
        if (isCash) {
          cashAllowances += allowanceValue;
          allowancesDetails.push({
            code: allowanceCode,
            name: allowance.allowance_types.name,
            value: allowanceValue,
            type: "CASH",
            is_taxable: allowance.allowance_types.is_taxable,
          });
        } else {
          // Process non-cash benefits based on code
          let taxableValue = 0;

          switch (allowanceCode) {
            case "CAR":
              taxableValue = calculateCarBenefit(allowanceValue);
              nonCashTaxableBenefits += taxableValue;
              allowancesDetails.push({
                code: "CAR",
                name: allowance.allowance_types.name,
                value: taxableValue,
                raw_value: allowanceValue,
                type: "NON_CASH_CAR",
                is_taxable: true,
              });
              break;
            case "MEAL":
              taxableValue = calculateMealBenefit(allowanceValue);
              nonCashTaxableBenefits += taxableValue;
              allowancesDetails.push({
                code: "MEAL",
                name: allowance.allowance_types.name,
                value: taxableValue,
                raw_value: allowanceValue,
                type: "NON_CASH_MEAL",
                is_taxable: taxableValue > 0,
                exempt_amount: taxableValue === 0 ? allowanceValue : 0,
              });
              break;
            case "HOUSING":
              allowancesDetails.push({
                code: "HOUSING",
                name: allowance.allowance_types.name,
                raw_value: allowanceValue,
                housing_type: allowance.metadata?.housing_type || "ORDINARY", // Assume metadata contains housing type
                type: "NON_CASH_HOUSING",
                is_taxable: true,
              });
              // Don't add to taxable benefits yet
              continue;
            default:
              // Other non-cash benefits
              taxableValue = calculateOtherNonCashBenefit(allowanceValue);
              allowancesDetails.push({
                code: allowanceCode,
                name: allowance.allowance_types.name,
                value: taxableValue,
                raw_value: allowanceValue,
                type: "NON_CASH_OTHER",
                is_taxable: taxableValue > 0,
              });
          }
          nonCashTaxableBenefits += taxableValue;
        }
      }

      // Calculate gross pay for statutory deductions (Basic + Cash Allowances)
      let grossPayForStatutory = basicSalary + cashAllowances;

      // Calculate statutory deductions
      const nssfResult = employee.pays_nssf
        ? calculateNSSF(
            grossPayForStatutory,
            payrollMonth,
            payrollYear,
            employeeType,
          )
        : { tier1: 0, tier2: 0, total: 0 };

      const shifDeduction = employee.pays_shif
        ? calculateSHIF(grossPayForStatutory, payrollYear, payrollMonth)
        : 0;
      const housingLevyDeduction = employee.pays_housing_levy
        ? calculateHousingLevy(grossPayForStatutory, payrollYear, payrollMonth)
        : 0;

      // Process housing benefit now that we have gross pay
      let housingBenefit = 0;
      const housingAllowance = allowancesDetails.find(
        (a) => a.code === "HOUSING",
      );
      if (housingAllowance) {
        housingBenefit = calculateHousingBenefit(
          housingAllowance.raw_value,
          grossPayForStatutory,
          housingAllowance.housing_type || "ORDINARY",
        );
        nonCashTaxableBenefits += housingBenefit;
        housingAllowance.value = housingBenefit;
        housingAllowance.raw_value = housingAllowance.raw_value;
      }

      // Calculate total gross pay including non-cash taxable benefits
      let totalGrossPay = grossPayForStatutory + nonCashTaxableBenefits;

      // Process deductions
      let preTaxDeductions = 0;
      let postTaxDeductions = 0;
      let deductionsDetails = [];
      let insurancePremium = 0;

      const employeeDeductions = allDeductions.filter(
        (d) =>
          d.employee_id === employee.id ||
          (d.employee_id === null &&
            d.department_id === employee.department_id) ||
          d.applies_to === "COMPANY",
      );

      for (const deduction of employeeDeductions) {
        let deductionValue = 0;

        if (deduction.calculation_type === "FIXED") {
          deductionValue = parseFloat(deduction.value);
        } else if (deduction.calculation_type === "PERCENTAGE") {
          deductionValue =
            grossPayForStatutory * (parseFloat(deduction.value) / 100);
        }

        // Apply maximum value constraint
        if (deduction.deduction_types.has_maximum_value) {
          deductionValue = Math.min(
            deductionValue,
            deduction.deduction_types.maximum_value,
          );
        }

        const deductionCode = deduction.deduction_types.code;
        const isPreTax = deduction.deduction_types.is_pre_tax;

        // Track insurance premium for relief (from any insurance-related deductions)
        if (
          deductionCode === "INS" ||
          deductionCode === "PRMF" ||
          deduction.deduction_types.name.toLowerCase().includes("insurance")
        ) {
          insurancePremium += deductionValue;
        }

        // For actual deductions (not just relief tracking)
        if (deductionCode !== "INS") {
          // Exclude INS from actual deductions if it's just for relief
          if (isPreTax) {
            preTaxDeductions += deductionValue;
          } else {
            postTaxDeductions += deductionValue;
          }
        }

        deductionsDetails.push({
          code: deductionCode,
          name: deduction.deduction_types.name,
          value: deductionValue,
          is_pre_tax: isPreTax,
          is_insurance_relief: deductionCode === "INS",
        });
      }

      // Calculate HELB deduction
      let helbDeduction = 0;
      if (employee.pays_helb && employee.helb_accounts?.length > 0) {
        const activeHelb = employee.helb_accounts.find(
          (a) => a.status === "ACTIVE",
        );
        if (activeHelb) {
          helbDeduction = parseFloat(activeHelb.monthly_deduction);
        }
      }
      postTaxDeductions += helbDeduction;

      // Calculate taxable income
      let taxableIncome =
        totalGrossPay -
        nssfResult.total -
        shifDeduction -
        housingLevyDeduction -
        preTaxDeductions;

      // Calculate PAYE with disability exemption
      let payeTax = employee.pays_paye
        ? calculatePAYE(taxableIncome, isDisabled)
        : 0;

      // Calculate insurance relief (15% of premium, capped at 5000)
      let insuranceRelief = Math.min(
        insurancePremium * 0.15,
        INSURANCE_RELIEF_CAP,
      );
      insuranceRelief = Math.round(insuranceRelief);
      payeTax = Math.max(0, payeTax - insuranceRelief);

      // Calculate total deductions and net pay
      let totalStatutoryDeductions =
        nssfResult.total + shifDeduction + housingLevyDeduction + payeTax;
      let totalDeductions = totalStatutoryDeductions + postTaxDeductions;
      let netPay = totalGrossPay - totalDeductions;

      // Get payment details
      const paymentDetails = employee.employee_payment_details || {};

      // Prepare payroll detail record
      payrollDetailsToInsert.push({
        id: uuidv4(),
        payroll_run_id: payrollRunId,
        employee_id: employee.id,
        basic_salary: parseFloat(employee.salary),
        total_cash_allowances: cashAllowances,
        total_non_cash_benefits: nonCashTaxableBenefits,
        total_allowances: cashAllowances + nonCashTaxableBenefits,
        total_deductions: totalDeductions,
        total_statutory_deductions: totalStatutoryDeductions,
        total_other_deductions: postTaxDeductions,
        gross_pay: grossPayForStatutory,
        taxable_income: taxableIncome,
        paye_tax: payeTax,
        nssf_deduction: nssfResult.total,
        nssf_tier1_deduction: nssfResult.tier1,
        nssf_tier2_deduction: nssfResult.tier2,
        shif_deduction: shifDeduction,
        helb_deduction: helbDeduction,
        housing_levy_deduction: housingLevyDeduction,
        net_pay: netPay,
        payment_method: paymentDetails.payment_method,
        bank_name: paymentDetails.bank_name,
        branch_name: paymentDetails.branch_name,
        branch_code: paymentDetails.branch_code,
        bank_code: paymentDetails.bank_code,
        account_name: paymentDetails.account_name,
        account_number: paymentDetails.account_number,
        mobile_type: paymentDetails.mobile_type,
        mobile_phone: paymentDetails.phone_number,
        allowances_details: allowancesDetails,
        deductions_details: deductionsDetails,
        insurance_relief: insuranceRelief,
        absent_days: absentDaysCount,
        absent_days_deduction: absentDaysDeduction,
        created_at: new Date().toISOString(),
      });

      // Update totals
      totals.totalGrossPay += totalGrossPay;
      totals.totalStatutoryDeductions += totalStatutoryDeductions;
      totals.totalPaye += payeTax;
      totals.totalNetPay += netPay;
      totals.totalNSSF += nssfResult.total;
      totals.totalSHIF += shifDeduction;
      totals.totalHousingLevy += housingLevyDeduction;
      totals.totalHELB += helbDeduction;
    }

    // 8. Insert all payroll details
    if (payrollDetailsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("payroll_details")
        .insert(payrollDetailsToInsert);

      if (insertError) throw insertError;
    }

    // 9. Update payroll run totals
    const { error: updateError } = await supabase
      .from("payroll_runs")
      .update({
        total_gross_pay: totals.totalGrossPay,
        total_statutory_deductions: totals.totalStatutoryDeductions,
        total_net_pay: totals.totalNetPay,
        updated_at: new Date().toISOString(),
        status: isNewRun ? "DRAFT" : existingRun.status, // Preserve status if exists
      })
      .eq("id", payrollRunId);

    if (updateError) throw updateError;

    // 8. Initialize reviews (make sure this doesn't duplicate)
    if (isNewRun) {
      await initializePayrollReviews(payrollRunId, companyId);
    }

    // Commit transaction
    await supabase.rpc("commit_transaction");

    // 10. Return response
    res.status(200).json({
      message: isNewRun
        ? "Payroll created successfully."
        : "Payroll synchronized successfully.",
      payrollRunId,
      isNewRun,
      totals,
    });
  } catch (error) {
    await supabase.rpc("rollback_transaction");
    console.error("Payroll sync error:", error);
    res.status(500).json({
      error: "Failed to sync payroll.",
      details: error.message,
    });
  }
};

// Keep other functions but update references
export const completePayrollRun = async (req, res) => {
  const { payrollRunId } = req.params;

  try {
    const { data: run, error: runError } = await supabase
      .from("payroll_runs")
      .select("id, status")
      .eq("id", payrollRunId)
      .maybeSingle();

    if (runError) throw new Error("Failed to fetch payroll run.");
    if (!run) return res.status(404).json({ error: "Payroll run not found." });

    // Allow completion from DRAFT, PREPARED, or UNDER_REVIEW
    const allowedStatuses = ["DRAFT", "PREPARED", "UNDER_REVIEW"];
    if (!allowedStatuses.includes(run.status)) {
      return res.status(400).json({
        error: `Payroll run cannot be completed from status: ${run.status}`,
      });
    }

    // Update HELB balances
    const { data: details } = await supabase
      .from("payroll_details")
      .select("employee_id, helb_deduction")
      .eq("payroll_run_id", payrollRunId)
      .gt("helb_deduction", 0);

    if (details) {
      for (const detail of details) {
        await supabase
          .from("helb_accounts")
          .update({
            current_balance: supabase.raw(
              `current_balance - ${detail.helb_deduction}`,
            ),
            updated_at: new Date().toISOString(),
          })
          .eq("employee_id", detail.employee_id)
          .eq("status", "ACTIVE");
      }
    }

    // Update payroll run status
    const { data: completedRun, error: updateError } = await supabase
      .from("payroll_runs")
      .update({
        status: "COMPLETED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payrollRunId)
      .select()
      .single();

    if (updateError) throw new Error("Failed to complete payroll run.");

    res.status(200).json(completedRun);
  } catch (error) {
    console.error("Complete payroll error:", error);
    res.status(500).json({ error: error.message });
  }
};

export const getPayrollRuns = async (req, res) => {
  const { companyId } = req.params;
  const { exclude, limit, month, year, sort } = req.query;

  try {
    const { data, error } = await supabase
      .from("payroll_runs")
      .select(
        `
        *,
        payroll_details (
          id,
          employee_id,
          gross_pay,
          net_pay
        )
      `,
      )
      .eq("company_id", companyId)
      .order("payroll_year", { ascending: false })
      .order("payroll_month", { ascending: false });

    if (error) throw new Error("Failed to fetch payroll runs.");

    // Add employee count
    const runsWithCounts = data.map((run) => ({
      ...run,
      employee_count: run.payroll_details?.length || 0,
      payroll_details: undefined, // Remove details from response
    }));

    res.status(200).json(runsWithCounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getPayrollDetails = async (req, res) => {
  const { runId } = req.params;

  try {
    const { data, error } = await supabase
      .from("payroll_details")
      .select(
        `
        *,
        employee:employee_id (
          first_name,
          last_name,
          employee_number,
          email,
          has_disability
        )
      `,
      )
      .eq("payroll_run_id", runId);

    if (error) throw new Error("Failed to fetch payroll details.");

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const cancelPayrollRun = async (req, res) => {
  const { payrollRunId } = req.params;

  try {
    const { data, error } = await supabase
      .from("payroll_runs")
      .update({
        status: "CANCELLED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payrollRunId)
      .in("status", ["DRAFT", "PREPARED"]) // Only allow canceling drafts or prepared
      .select();

    if (error) throw new Error("Failed to cancel payroll run.");

    if (data.length === 0) {
      return res.status(404).json({
        error: "Payroll run not found or cannot be cancelled.",
      });
    }

    res.status(200).json({ message: "Payroll run cancelled successfully." });
  } catch (error) {
    console.error("Cancel payroll error:", error);
    res.status(500).json({ error: error.message });
  }
};

export const getPayrollYears = async (req, res) => {
  const { companyId } = req.params;

  try {
    const { data, error } = await supabase
      .from("payroll_runs")
      .select("payroll_year")
      .eq("company_id", companyId)
      .order("payroll_year", { ascending: false });

    if (error) throw new Error("Failed to fetch payroll years.");

    const uniqueYears = [...new Set(data.map((item) => item.payroll_year))];

    res.status(200).json({
      success: true,
      data: uniqueYears,
    });
  } catch (err) {
    console.error("Error fetching payroll years:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payroll years.",
    });
  }
};

// Function to initialize reviews when payroll moves to UNDER_REVIEW
export const initializePayrollReviews = async (payrollRunId, companyId) => {
  try {
    // 1. Get all active reviewers for the company ordered by level
    const { data: reviewers, error: revError } = await supabase
      .from("company_reviewers")
      .select("id, reviewer_level")
      .eq("company_id", companyId)
      .order("reviewer_level", { ascending: true });

    if (revError) throw revError;
    if (!reviewers || reviewers.length === 0) {
      console.log("No reviewers configured for company:", companyId);
      return;
    }

    // 2. Get all newly created payroll details
    const { data: details, error: detError } = await supabase
      .from("payroll_details")
      .select("id")
      .eq("payroll_run_id", payrollRunId);

    if (detError) throw detError;
    if (!details || details.length === 0) return;

    // 3. Prepare review entries (Cross-join: Every reviewer reviews every employee)
    const reviewEntries = [];
    details.forEach((detail) => {
      reviewers.forEach((reviewer) => {
        reviewEntries.push({
          payroll_detail_id: detail.id,
          company_reviewer_id: reviewer.id,
          status: "PENDING",
          //created_at: new Date().toISOString()
        });
      });
    });

    // 4. Batch insert
    const { error: insertError } = await supabase
      .from("payroll_reviews")
      .insert(reviewEntries);

    if (insertError) throw insertError;
  } catch (error) {
    console.error("Critical: Failed to initialize payroll reviews:", error);
  }
};

// Get summary of review progress for a payroll run
// Get summary of review progress for a payroll run
export const getPayrollReviewStatus = async (req, res) => {
  const { runId, companyId } = req.params;

  try {
    // Get payroll run info
    const { data: payrollRun, error: payrollError } = await supabase
      .from("payroll_runs")
      .select("payroll_month, payroll_year, payroll_number, status")
      .eq("id", runId)
      .eq("company_id", companyId)
      .single();

    if (payrollError) throw payrollError;

    // Get all company reviewers with their details from company_users
    const { data: companyReviewers, error: reviewersError } = await supabase
      .from("company_reviewers")
      .select(
        `
        id,
        reviewer_level,
        company_user_id,
        company_users!inner (
          full_name,
          email
        )
      `,
      )
      .eq("company_id", companyId)
      .order("reviewer_level", { ascending: true });

    if (reviewersError) throw reviewersError;

    // If no reviewers found, return empty steps
    if (!companyReviewers || companyReviewers.length === 0) {
      return res.json({
        payroll: payrollRun,
        steps: [],
      });
    }

    // Get all payroll details for this run to know total items
    const { data: payrollDetails, error: detailsError } = await supabase
      .from("payroll_details")
      .select("id")
      .eq("payroll_run_id", runId);

    if (detailsError) throw detailsError;

    const payrollDetailIds = payrollDetails.map((d) => d.id);
    const totalItems = payrollDetailIds.length;

    // Get all reviews for this run
    const { data: reviews, error: reviewsError } = await supabase
      .from("payroll_reviews")
      .select(
        `
        status,
        company_reviewer_id
      `,
      )
      .in("payroll_detail_id", payrollDetailIds);

    if (reviewsError) throw reviewsError;

    // Create a map of review counts by reviewer
    const reviewStats = reviews.reduce((acc, review) => {
      if (!acc[review.company_reviewer_id]) {
        acc[review.company_reviewer_id] = {
          approved: 0,
          rejected: 0,
        };
      }

      if (review.status === "APPROVED") {
        acc[review.company_reviewer_id].approved++;
      } else if (review.status === "REJECTED") {
        acc[review.company_reviewer_id].rejected++;
      }

      return acc;
    }, {});

    // Build steps for all reviewers with actual names
    const steps = companyReviewers.map((reviewer) => {
      const stats = reviewStats[reviewer.id] || { approved: 0, rejected: 0 };

      // Use full_name from company_users, fallback to email or level
      const reviewerName =
        reviewer.company_users?.full_name ||
        reviewer.company_users?.email?.split("@")[0] ||
        `Reviewer Level ${reviewer.reviewer_level}`;

      return {
        reviewer_id: reviewer.id,
        reviewer_name: reviewerName,
        reviewer_email: reviewer.company_users?.email || null,
        reviewer_level: reviewer.reviewer_level,
        total_items: totalItems,
        approved_items: stats.approved,
        rejected_items: stats.rejected,
        pending_items: totalItems - stats.approved - stats.rejected,
        completion_percentage:
          totalItems > 0 ? Math.round((stats.approved / totalItems) * 100) : 0,
      };
    });

    res.json({
      payroll: payrollRun,
      steps: steps,
    });
  } catch (error) {
    console.error("Error fetching review status:", error);
    res.status(500).json({ error: "Failed to fetch review status" });
  }
};

export const updateItemReviewStatus = async (req, res) => {
  const { reviewId } = req.params;
  const { status } = req.body; // 'APPROVED', 'REJECTED', or 'PENDING'

  try {
    const { data, error } = await supabase
      .from("payroll_reviews")
      .update({
        status,
        reviewed_at: status === "PENDING" ? null : new Date().toISOString(),
      })
      .eq("id", reviewId)
      .select();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Update failed" });
  }
};

// backend/controllers/payrollController.js

// Add this new function for bulk review updates
export const bulkUpdateReviewStatus = async (req, res) => {
  const { companyId } = req.params;
  const { reviewIds, status } = req.body; // status: 'APPROVED', 'REJECTED', or 'PENDING'

  if (!reviewIds || !Array.isArray(reviewIds) || reviewIds.length === 0) {
    return res.status(400).json({ error: "Review IDs array is required" });
  }

  if (!status || !['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
    return res.status(400).json({ error: "Valid status is required" });
  }

  try {
    // First, verify that all reviews belong to this company
    // This is an extra security check to prevent updating reviews from other companies
    const { data: reviews, error: fetchError } = await supabase
      .from("payroll_reviews")
      .select(`
        id,
        payroll_detail_id,
        payroll_details!inner (
          payroll_run_id,
          payroll_runs!inner (
            company_id
          )
        )
      `)
      .in("id", reviewIds);

    if (fetchError) throw fetchError;

    // Check if all reviews belong to the company
    const invalidReviews = reviews.filter(
      review => review.payroll_details?.payroll_runs?.company_id !== companyId
    );

    if (invalidReviews.length > 0) {
      return res.status(403).json({ 
        error: "Some reviews do not belong to this company" 
      });
    }

    // Perform bulk update
    const { data, error } = await supabase
      .from("payroll_reviews")
      .update({
        status,
        reviewed_at: status === "PENDING" ? null : new Date().toISOString(),
      })
      .in("id", reviewIds)
      .select();

    if (error) throw error;

    res.json({
      message: `Successfully updated ${data.length} review(s)`,
      updated: data
    });
  } catch (error) {
    console.error("Bulk update error:", error);
    res.status(500).json({ error: "Bulk update failed" });
  }
};

// Get single payroll run with summary
export const getPayrollRun = async (req, res) => {
  const { runId } = req.params;
  const { companyId } = req.params;

  try {
    const { data, error } = await supabase
      .from("payroll_runs")
      .select("*, payroll_details(*)")
      .eq("id", runId)
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: "Payroll run not found." });
    }

    const details = data.payroll_details || [];
    const totals = {
      count: details.length,
      total_gross: details.reduce(
        (acc, curr) => acc + (parseFloat(curr.gross_pay) || 0),
        0,
      ),
      total_net: details.reduce(
        (acc, curr) => acc + (parseFloat(curr.net_pay) || 0),
        0,
      ),
      total_paye: details.reduce(
        (acc, curr) => acc + (parseFloat(curr.paye_tax) || 0),
        0,
      ),
      total_nssf: details.reduce(
        (acc, curr) => acc + (parseFloat(curr.nssf_deduction) || 0),
        0,
      ),
      total_shif: details.reduce(
        (acc, curr) => acc + (parseFloat(curr.shif_deduction) || 0),
        0,
      ),
      total_helb: details.reduce(
        (acc, curr) => acc + (parseFloat(curr.helb_deduction) || 0),
        0,
      ),
      total_housing_levy: details.reduce(
        (acc, curr) => acc + (parseFloat(curr.housing_levy_deduction) || 0),
        0,
      ),
    };

    // Get employee count
    const { count } = await supabase
      .from("payroll_details")
      .select("*", { count: "exact", head: true })
      .eq("payroll_run_id", runId);

    res.status(200).json({
      ...data,
      employee_count: details.length,
      calculated_totals: totals,
    });
  } catch (error) {
    console.error("Get payroll run error:", error);
    res.status(500).json({ error: "Failed to fetch payroll run." });
  }
};

// Update payroll status with validation
export const updatePayrollStatus = async (req, res) => {
  const { runId } = req.params;
  const { status } = req.body;
  const userId = req.userId;
  const currentStatus = req.payrollStatus;

  // Define valid status transitions
  const validTransitions = {
    DRAFT: ["PREPARED", "UNDER_REVIEW", "CANCELLED"],
    PREPARED: ["UNDER_REVIEW", "DRAFT", "CANCELLED"],
    UNDER_REVIEW: ["APPROVED", "REJECTED", "DRAFT"],
    APPROVED: ["LOCKED", "PAID", "DRAFT"],
    LOCKED: ["PAID", "UNLOCKED"],
    UNLOCKED: ["DRAFT", "LOCKED"],
    PAID: ["COMPLETED"],
    COMPLETED: [],
    CANCELLED: ["DRAFT"],
    REJECTED: ["DRAFT"],
  };

  // Check if transition is valid
  if (!validTransitions[currentStatus]?.includes(status)) {
    return res.status(400).json({
      error: `Cannot transition from ${currentStatus} to ${status}.`,
    });
  }

  try {
    const { data, error } = await supabase
      .from("payroll_runs")
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...(status === "LOCKED" && {
          locked_at: new Date().toISOString(),
          locked_by: userId,
        }),
        ...(status === "UNLOCKED" && { locked_at: null, locked_by: null }),
      })
      .eq("id", runId)
      .select()
      .single();

    if (error) throw error;

    // Log the status change
    await supabase.from("audit_logs").insert({
      entity_type: "payroll_run",
      entity_id: runId,
      action: "UPDATE",
      performed_by: userId,
      new_data: { status, previous_status: currentStatus },
      created_at: new Date().toISOString(),
    });

    res.status(200).json(data);
  } catch (error) {
    console.error("Update payroll status error:", error);
    res.status(500).json({ error: "Failed to update payroll status." });
  }
};

// Lock payroll run
export const lockPayrollRun = async (req, res) => {
  req.body.status = "LOCKED";
  return updatePayrollStatus(req, res);
};

// Unlock payroll run
export const unlockPayrollRun = async (req, res) => {
  req.body.status = "UNLOCKED";
  return updatePayrollStatus(req, res);
};

// Mark as paid
export const markAsPaid = async (req, res) => {
  req.body.status = "PAID";
  return updatePayrollStatus(req, res);
};

// Get payroll summary for dashboard
export const getPayrollSummary = async (req, res) => {
  const { companyId } = req.params;

  try {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();

    // Get current month payroll
    const { data: currentPayroll } = await supabase
      .from("payroll_runs")
      .select(
        `
        id,
        status,
        total_gross_pay,
        total_net_pay,
        payroll_month,
        payroll_year
      `,
      )
      .eq("company_id", companyId)
      .eq("payroll_month", monthNames[currentMonth])
      .eq("payroll_year", currentYear)
      .maybeSingle();

    // Get pending approvals
    const { count: pendingCount } = await supabase
      .from("payroll_runs")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", ["PREPARED", "UNDER_REVIEW"]);

    // Get yearly totals
    const { data: yearlyTotals } = await supabase
      .from("payroll_runs")
      .select("total_gross_pay, total_net_pay, status")
      .eq("company_id", companyId)
      .eq("payroll_year", currentYear)
      .in("status", ["PAID", "COMPLETED"]);

    const yearlyGross =
      yearlyTotals?.reduce((sum, run) => sum + (run.total_gross_pay || 0), 0) ||
      0;
    const yearlyNet =
      yearlyTotals?.reduce((sum, run) => sum + (run.total_net_pay || 0), 0) ||
      0;

    res.status(200).json({
      current_month: {
        exists: !!currentPayroll,
        status: currentPayroll?.status || null,
        total_gross: currentPayroll?.total_gross_pay || 0,
        total_net: currentPayroll?.total_net_pay || 0,
      },
      pending_approvals: pendingCount || 0,
      yearly_total_gross: yearlyGross,
      yearly_total_net: yearlyNet,
    });
  } catch (error) {
    console.error("Get payroll summary error:", error);
    res.status(500).json({ error: "Failed to fetch payroll summary." });
  }
};

// Delete payroll run (ADMIN only)
export const deletePayrollRun = async (req, res) => {
  const { runId } = req.params;

  // Only allow deletion of DRAFT or CANCELLED runs
  if (!["DRAFT", "CANCELLED"].includes(req.payrollStatus)) {
    return res.status(400).json({
      error: `Cannot delete payroll run with status: ${req.payrollStatus}`,
    });
  }

  try {
    // Delete payroll details first (cascade should handle this but being explicit)
    await supabase.from("payroll_details").delete().eq("payroll_run_id", runId);

    // Delete the payroll run
    const { error } = await supabase
      .from("payroll_runs")
      .delete()
      .eq("id", runId);

    if (error) throw error;

    res.status(200).json({ message: "Payroll run deleted successfully." });
  } catch (error) {
    console.error("Delete payroll run error:", error);
    res.status(500).json({ error: "Failed to delete payroll run." });
  }
};
