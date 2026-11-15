---------------------------- MODULE MoveIgnoresTerminal ----------------------------
CONSTANT Types

VARIABLES type, stage, present, lastMove

vars == <<type, stage, present, lastMove>>

Invoice ==
  [ stages |-> {"draft", "sent", "paid", "void"},
    initial |-> "draft",
    terminal |-> {"paid", "void"},
    fields |-> {"number", "amount", "due", "customer"},
    transitions |-> {
      [from |-> "draft", to |-> "sent", requires |-> {"number", "amount"}],
      [from |-> "sent", to |-> "paid", requires |-> {}],
      [from |-> "draft", to |-> "void", requires |-> {}],
      [from |-> "sent", to |-> "void", requires |-> {}] } ]

Booking ==
  [ stages |-> {"requested", "confirmed", "completed", "cancelled", "no_show"},
    initial |-> "requested",
    terminal |-> {"completed", "cancelled", "no_show"},
    fields |-> {"customer", "service", "starts", "ends", "party_size", "deposit_paid", "notes"},
    transitions |-> {
      [from |-> "requested", to |-> "confirmed", requires |-> {"starts"}],
      [from |-> "confirmed", to |-> "requested", requires |-> {}],
      [from |-> "confirmed", to |-> "completed", requires |-> {"starts", "ends"}],
      [from |-> "confirmed", to |-> "no_show", requires |-> {}],
      [from |-> "requested", to |-> "cancelled", requires |-> {}],
      [from |-> "confirmed", to |-> "cancelled", requires |-> {}] } ]

InventoryItem ==
  [ stages |-> {"in_stock", "low", "out_of_stock", "discontinued"},
    initial |-> "in_stock",
    terminal |-> {"discontinued"},
    fields |-> {"sku", "name", "quantity", "unit", "unit_cost", "reorder_at", "location"},
    transitions |-> {
      [from |-> "in_stock", to |-> "low", requires |-> {"quantity", "reorder_at"}],
      [from |-> "in_stock", to |-> "out_of_stock", requires |-> {}],
      [from |-> "low", to |-> "out_of_stock", requires |-> {}],
      [from |-> "low", to |-> "in_stock", requires |-> {"quantity"}],
      [from |-> "out_of_stock", to |-> "in_stock", requires |-> {"quantity"}],
      [from |-> "in_stock", to |-> "discontinued", requires |-> {}],
      [from |-> "low", to |-> "discontinued", requires |-> {}],
      [from |-> "out_of_stock", to |-> "discontinued", requires |-> {}] } ]

Case ==
  [ stages |-> {"open", "in_progress", "waiting", "resolved", "closed"},
    initial |-> "open",
    terminal |-> {"closed"},
    fields |-> {"title", "description", "priority", "opened", "assignee", "parent", "resolution"},
    transitions |-> {
      [from |-> "open", to |-> "in_progress", requires |-> {"assignee"}],
      [from |-> "in_progress", to |-> "waiting", requires |-> {}],
      [from |-> "waiting", to |-> "in_progress", requires |-> {}],
      [from |-> "in_progress", to |-> "resolved", requires |-> {"resolution"}],
      [from |-> "waiting", to |-> "resolved", requires |-> {"resolution"}],
      [from |-> "resolved", to |-> "in_progress", requires |-> {}],
      [from |-> "open", to |-> "closed", requires |-> {}],
      [from |-> "resolved", to |-> "closed", requires |-> {}] } ]

PresetTypes == {Invoice, Booking, InventoryItem, Case}

SmallStages == {"s1", "s2", "s3"}
SmallFields == {"f1"}
SmallPairs == SmallStages \X SmallStages
PairRules == {"not declared", "declared", "declared with a required field"}

SmallTransitions(rule) ==
  { [from |-> pair[1], to |-> pair[2],
     requires |-> IF rule[pair] = "declared with a required field" THEN SmallFields ELSE {}] :
    pair \in {declared \in SmallPairs : rule[declared] # "not declared"} }

EverySmallType ==
  { [stages |-> SmallStages, initial |-> "s1", terminal |-> terminal,
     fields |-> SmallFields, transitions |-> SmallTransitions(rule)] :
    terminal \in SUBSET SmallStages, rule \in [SmallPairs -> PairRules] }

CheckedTypes == PresetTypes \cup EverySmallType

Closed(t) ==
  /\ t.initial \in t.stages
  /\ t.terminal \subseteq t.stages
  /\ \A tr \in t.transitions :
       tr.from \in t.stages /\ tr.to \in t.stages /\ tr.requires \subseteq t.fields

ASSUME \A t \in Types : Closed(t)

Declared(t, from, to) == \E tr \in t.transitions : tr.from = from /\ tr.to = to

Required(t, from, to) == UNION {tr.requires : tr \in {d \in t.transitions : d.from = from /\ d.to = to}}

Gating(t) == UNION {tr.requires : tr \in t.transitions}

TypeOK ==
  /\ Closed(type)
  /\ stage \in type.stages
  /\ present \subseteq Gating(type)
  /\ \A move \in lastMove :
       move.from \in type.stages /\ move.to \in type.stages /\ move.had \subseteq Gating(type)

Init ==
  /\ type \in Types
  /\ stage = type.initial
  /\ present \in SUBSET Gating(type)
  /\ lastMove = {}

Update(field) ==
  /\ present' = IF field \in present THEN present \ {field} ELSE present \cup {field}
  /\ UNCHANGED <<type, stage, lastMove>>

Move(to) ==
  /\ Declared(type, stage, to)
  /\ Required(type, stage, to) \subseteq present
  /\ stage' = to
  /\ lastMove' = {[from |-> stage, to |-> to, had |-> present]}
  /\ UNCHANGED <<type, present>>

Next ==
  \/ \E field \in Gating(type) : Update(field)
  \/ \E to \in type.stages : Move(to)

Spec == Init /\ [][Next]_vars

OnlyDeclaredTransitions == \A move \in lastMove : Declared(type, move.from, move.to)

TerminalIsFinal == \A move \in lastMove : move.from \notin type.terminal

RequiredFieldsBeforeMove == \A move \in lastMove : Required(type, move.from, move.to) \subseteq move.had
=============================================================================
