package app

import (
	"context"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
)

// --- Finanzas (panel de administración) --------------------------------------

type financeMonth struct {
	ID          bigint `db:"id" json:"id"`
	PeriodStart string `db:"periodStart" json:"periodStart"`
	PeriodEnd   string `db:"periodEnd" json:"periodEnd"`
	GrossSales  string `db:"grossSales" json:"grossSales"`
	Discounts   string `db:"discounts" json:"discounts"`
	NetSales    string `db:"netSales" json:"netSales"`
	Shipping    string `db:"shippingRevenue" json:"shippingRevenue"`
	CostOfGoods string `db:"costOfGoods" json:"costOfGoods"`
	GrossProfit string `db:"grossProfit" json:"grossProfit"`
	OpEx        string `db:"operatingExpenses" json:"operatingExpenses"`
	Payroll     string `db:"payroll" json:"payroll"`
	Taxes       string `db:"taxes" json:"taxes"`
	NetProfit   string `db:"netProfit" json:"netProfit"`
	Inventory   string `db:"inventoryPurchases" json:"inventoryPurchases"`
}

type financeExpenseCategory struct {
	Category string `db:"category" json:"category"`
	Total    string `db:"total" json:"total"`
	Count    int    `db:"count" json:"count"`
}

type financeExpense struct {
	ID            bigint  `db:"id" json:"id"`
	Category      string  `db:"category" json:"category"`
	Description   string  `db:"description" json:"description"`
	Amount        string  `db:"amount" json:"amount"`
	Date          string  `db:"date" json:"date"`
	PaymentMethod *string `db:"paymentMethod" json:"paymentMethod"`
	Receipt       *string `db:"receipt" json:"receipt"`
	Notes         *string `db:"notes" json:"notes"`
}

type financePayroll struct {
	ID          bigint  `db:"id" json:"id"`
	Employee    string  `db:"employee" json:"employee"`
	Position    string  `db:"position" json:"position"`
	PeriodStart string  `db:"periodStart" json:"periodStart"`
	PeriodEnd   string  `db:"periodEnd" json:"periodEnd"`
	Gross       string  `db:"gross" json:"gross"`
	Deductions  string  `db:"deductions" json:"deductions"`
	Net         *string `db:"net" json:"net"`
	PaymentDate *string `db:"paymentDate" json:"paymentDate"`
	Status      string  `db:"status" json:"status"`
	Notes       *string `db:"notes" json:"notes"`
}

type financeTax struct {
	ID          bigint  `db:"id" json:"id"`
	Name        string  `db:"name" json:"name"`
	Type        string  `db:"type" json:"type"`
	PeriodStart string  `db:"periodStart" json:"periodStart"`
	PeriodEnd   string  `db:"periodEnd" json:"periodEnd"`
	Amount      string  `db:"amount" json:"amount"`
	DueDate     string  `db:"dueDate" json:"dueDate"`
	PaymentDate *string `db:"paymentDate" json:"paymentDate"`
	Status      string  `db:"status" json:"status"`
	Reference   *string `db:"reference" json:"reference"`
}

type financePurchase struct {
	ID            bigint  `db:"id" json:"id"`
	Supplier      string  `db:"supplier" json:"supplier"`
	Invoice       *string `db:"invoice" json:"invoice"`
	Date          string  `db:"date" json:"date"`
	Total         string  `db:"total" json:"total"`
	PaymentMethod *string `db:"paymentMethod" json:"paymentMethod"`
	Status        string  `db:"status" json:"status"`
	PaymentDate   *string `db:"paymentDate" json:"paymentDate"`
	Notes         *string `db:"notes" json:"notes"`
}

type financeSupplierTotal struct {
	Supplier string `db:"supplier" json:"supplier"`
	Total    string `db:"total" json:"total"`
	Count    int    `db:"count" json:"count"`
}

// paged envuelve una sección paginada del panel de finanzas.
type paged[T any] struct {
	Items    []T `json:"items"`
	Total    int `json:"total"`
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
}

// intParam lee un parámetro de consulta entero con límites.
func intParam(raw string, fallback, min, max int) int {
	v, err := strconv.Atoi(raw)
	if err != nil || v < min {
		return fallback
	}
	if max > 0 && v > max {
		return max
	}
	return v
}

// financePage ejecuta el COUNT y la página solicitada de una sección.
func financePage[T any](ctx context.Context, pool *pgxpool.Pool, countSQL, listSQL string, page, size int) (paged[T], error) {
	out := paged[T]{Items: []T{}, Page: page, PageSize: size}
	if err := pool.QueryRow(ctx, countSQL).Scan(&out.Total); err != nil {
		return out, err
	}
	items, err := collect[T](pool.Query(ctx, listSQL, size, (page-1)*size))
	if err != nil {
		return out, err
	}
	out.Items = items
	return out, nil
}

// adminFinances devuelve los resúmenes mensuales y el detalle paginado de
// gastos, planilla, impuestos y compras a proveedores. Parámetros:
// ?expensesPage=N&payrollPage=N&taxesPage=N&purchasesPage=N&pageSize=10
func (a *App) adminFinances(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.requireAdmin(r); err != nil {
		return err
	}
	ctx := r.Context()
	q := r.URL.Query()
	pageSize := intParam(q.Get("pageSize"), 10, 5, 50)
	expensesPage := intParam(q.Get("expensesPage"), 1, 1, 0)
	payrollPage := intParam(q.Get("payrollPage"), 1, 1, 0)
	taxesPage := intParam(q.Get("taxesPage"), 1, 1, 0)
	purchasesPage := intParam(q.Get("purchasesPage"), 1, 1, 0)

	type result struct {
		months            []financeMonth
		expenseCategories []financeExpenseCategory
		expenses          paged[financeExpense]
		payroll           paged[financePayroll]
		taxes             paged[financeTax]
		purchases         paged[financePurchase]
		suppliers         []financeSupplierTotal
	}
	var res result
	var err error

	done := make(chan error, 7)
	go func() {
		var qerr error
		res.months, qerr = collect[financeMonth](a.pool.Query(ctx, `
			SELECT summary_id AS id, period_start::text AS "periodStart", period_end::text AS "periodEnd",
			       gross_sales_nio AS "grossSales", discounts_nio AS discounts,
			       net_sales_nio AS "netSales", shipping_revenue_nio AS "shippingRevenue",
			       cost_of_goods_nio AS "costOfGoods", gross_profit_nio AS "grossProfit",
			       operating_expenses_nio AS "operatingExpenses", payroll_nio AS payroll,
			       taxes_nio AS taxes, net_profit_nio AS "netProfit",
			       inventory_purchases_nio AS "inventoryPurchases"
			FROM monthly_financial_summaries ORDER BY period_start`))
		done <- qerr
	}()
	go func() {
		var qerr error
		res.expenseCategories, qerr = collect[financeExpenseCategory](a.pool.Query(ctx, `
			SELECT category, SUM(amount_nio) AS total, COUNT(*)::int AS count
			FROM operating_expenses GROUP BY category ORDER BY total DESC, category`))
		done <- qerr
	}()
	go func() {
		var qerr error
		res.expenses, qerr = financePage[financeExpense](ctx, a.pool,
			`SELECT count(*)::int FROM operating_expenses`, `
			SELECT expense_id AS id, category, description, amount_nio AS amount,
			       expense_date::text AS date, payment_method AS "paymentMethod",
			       receipt_reference AS receipt, notes
			FROM operating_expenses ORDER BY expense_date DESC, expense_id DESC
			LIMIT $1 OFFSET $2`,
			expensesPage, pageSize)
		done <- qerr
	}()
	go func() {
		var qerr error
		res.payroll, qerr = financePage[financePayroll](ctx, a.pool,
			`SELECT count(*)::int FROM payroll_records`, `
			SELECT payroll_id AS id, employee_name AS employee, position,
			       period_start::text AS "periodStart", period_end::text AS "periodEnd",
			       gross_amount_nio AS gross, deductions_nio AS deductions,
			       net_amount_nio AS net, payment_date::text AS "paymentDate",
			       payment_status AS status, notes
			FROM payroll_records ORDER BY period_start DESC, employee_name
			LIMIT $1 OFFSET $2`,
			payrollPage, pageSize)
		done <- qerr
	}()
	go func() {
		var qerr error
		res.taxes, qerr = financePage[financeTax](ctx, a.pool,
			`SELECT count(*)::int FROM tax_obligations`, `
			SELECT tax_id AS id, tax_name AS name, tax_type AS type,
			       period_start::text AS "periodStart", period_end::text AS "periodEnd",
			       amount_nio AS amount, due_date::text AS "dueDate",
			       payment_date::text AS "paymentDate", payment_status AS status,
			       reference_number AS reference
			FROM tax_obligations ORDER BY due_date DESC, tax_id DESC
			LIMIT $1 OFFSET $2`,
			taxesPage, pageSize)
		done <- qerr
	}()
	go func() {
		var qerr error
		res.purchases, qerr = financePage[financePurchase](ctx, a.pool,
			`SELECT count(*)::int FROM supplier_purchases`, `
			SELECT purchase_id AS id, supplier_name AS supplier, invoice_number AS invoice,
			       purchase_date::text AS date, total_amount_nio AS total,
			       payment_method AS "paymentMethod", payment_status AS status,
			       payment_date::text AS "paymentDate", notes
			FROM supplier_purchases ORDER BY purchase_date DESC, purchase_id DESC
			LIMIT $1 OFFSET $2`,
			purchasesPage, pageSize)
		done <- qerr
	}()
	go func() {
		var qerr error
		res.suppliers, qerr = collect[financeSupplierTotal](a.pool.Query(ctx, `
			SELECT supplier_name AS supplier, SUM(total_amount_nio) AS total, COUNT(*)::int AS count
			FROM supplier_purchases GROUP BY supplier_name ORDER BY total DESC, supplier_name`))
		done <- qerr
	}()

	for i := 0; i < 7; i++ {
		if qerr := <-done; qerr != nil && err == nil {
			err = qerr
		}
	}
	if err != nil {
		return err
	}

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"months":            res.months,
		"expenseCategories": res.expenseCategories,
		"expenses":          res.expenses,
		"payroll":           res.payroll,
		"taxes":             res.taxes,
		"purchases":         res.purchases,
		"suppliers":         res.suppliers,
	})
	return nil
}
