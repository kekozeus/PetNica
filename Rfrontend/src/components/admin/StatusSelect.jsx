export default function StatusSelect({ values, value, onChange, className, name }) {
  return (
    <select
      className={className}
      name={name}
      value={value}
      onChange={onChange}
    >
      {Object.entries(values).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  )
}
