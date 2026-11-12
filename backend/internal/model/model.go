package model

import "time"

type User struct {
	ID        uint      `json:"id"`
	Username  string    `json:"username" gorm:"uniqueIndex;size:64"`
	Password  string    `json:"-"`
	Admin     bool      `json:"admin"`
	CreatedAt time.Time `json:"created_at"`
}
type Session struct {
	ID        string `gorm:"primaryKey"`
	UserID    uint   `gorm:"index"`
	CSRF      string
	ExpiresAt time.Time
}

// Documents are owner-scoped typed aggregates. Recipes preserve complete immutable versions.
type Document struct {
	ID        uint      `json:"id"`
	UserID    uint      `json:"-" gorm:"index:owner_kind"`
	Kind      string    `json:"kind" gorm:"index:owner_kind"`
	Data      string    `json:"-" gorm:"type:text"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
type JobEvent struct {
	Detail  string    `json:"detail,omitempty"`
	Status  string    `json:"status"`
	Message string    `json:"message"`
	At      time.Time `json:"at"`
}
type Job struct {
	ResultKind  string     `json:"result_kind"`
	Events      []JobEvent `json:"events" gorm:"serializer:json;type:text"`
	ID          uint       `json:"id"`
	UserID      uint       `json:"-" gorm:"index"`
	Status      string     `json:"status"`
	Error       string     `json:"error"`
	Request     string     `json:"-"`
	RecipeID    uint       `json:"recipe_id"`
	SearchCalls int        `json:"search_calls"`
	FetchCalls  int        `json:"fetch_calls"`
	CreatedAt   time.Time  `json:"created_at"`
}
type Cache struct {
	Key       string `gorm:"primaryKey"`
	Data      string `gorm:"type:text"`
	ExpiresAt time.Time
}
type Setting struct {
	Key   string `gorm:"primaryKey"`
	Value string
}
type Migration struct {
	Version   uint `gorm:"primaryKey"`
	AppliedAt time.Time
}
type Nutrition struct {
	Calories float64 `json:"calories"`
	Protein  float64 `json:"protein"`
	Fat      float64 `json:"fat"`
	Carbs    float64 `json:"carbs"`
}
type Equipment struct {
	ID          uint     `json:"id"`
	Name        string   `json:"name"`
	Capacity    *float64 `json:"capacity"`
	Unit        string   `json:"unit"`
	Electric    bool     `json:"electric"`
	Watts       *float64 `json:"watts"`
	Description string   `json:"description"`
}
type Pantry struct {
	Name     string   `json:"name"`
	Category string   `json:"category"`
	Quantity *float64 `json:"quantity"`
	Unit     string   `json:"unit"`
	Notes    string   `json:"notes"`
}
type Price struct {
	Name      string     `json:"name"`
	Price     *float64   `json:"price"`
	Unit      string     `json:"unit"`
	Nutrition *Nutrition `json:"nutrition_per_100g"`
}
type Preferences struct {
	Allergies        []string `json:"allergies"`
	Avoid            []string `json:"avoid"`
	Dislikes         []string `json:"dislikes"`
	Tastes           []string `json:"tastes"`
	Cuisines         []string `json:"cuisines"`
	Notes            string   `json:"notes"`
	Theme            string   `json:"theme"`
	ElectricityPrice float64  `json:"electricity_price"`
}
type Request struct {
	Target       string   `json:"target"`
	Servings     int      `json:"servings"`
	Ingredients  []string `json:"ingredients"`
	Mode         string   `json:"mode"`
	EquipmentIDs []uint   `json:"equipment_ids"`
	Minutes      *float64 `json:"minutes"`
	Budget       *float64 `json:"budget"`
	Tags         []string `json:"tags"`
	Description  string   `json:"description"`
	Search       bool     `json:"search"`
	DishCount    int      `json:"dish_count"`
}
type Ingredient struct {
	Name            string     `json:"name"`
	Quantity        float64    `json:"quantity"`
	Unit            string     `json:"unit"`
	IsPantry        bool       `json:"is_pantry"`
	Weight          *float64   `json:"estimated_edible_weight_g"`
	Price           *float64   `json:"estimated_price_per_kg"`
	Nutrition       *Nutrition `json:"nutrition_per_100g"`
	Cost            *float64   `json:"cost"`
	CostSource      string     `json:"cost_source"`
	NutritionSource string     `json:"nutrition_source"`
	Totals          Nutrition  `json:"totals"`
}
type Step struct {
	Step        int      `json:"step"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Duration    float64  `json:"duration_minutes"`
	Start       float64  `json:"start_minute"`
	EquipmentID uint     `json:"equipment_id"`
	Temperature *float64 `json:"temperature_c"`
	PowerLevel  string   `json:"power_level"`
	SafetyNote  string   `json:"safety_note"`
}
type Usage struct {
	EquipmentID    uint     `json:"equipment_id"`
	HeatingMinutes float64  `json:"heating_minutes"`
	DutyCycle      *float64 `json:"duty_cycle"`
	KWh            *float64 `json:"theoretical_kwh"`
	EstimatedKWh   *float64 `json:"estimated_kwh"`
}
type DishImage struct {
	URL       string `json:"url"`
	SourceURL string `json:"source_url"`
	Title     string `json:"title"`
	Credit    string `json:"credit"`
	License   string `json:"license"`
}

type Dish struct {
	Image       *DishImage   `json:"image,omitempty"`
	Tags        []string     `json:"tags"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Ingredients []Ingredient `json:"ingredients"`
	Equipment   []uint       `json:"equipment"`
	PrepMinutes float64      `json:"prep_minutes"`
	CookMinutes float64      `json:"cook_minutes"`
	Steps       []Step       `json:"steps"`
	Cost        float64      `json:"cost"`
	Nutrition   Nutrition    `json:"nutrition"`
}
type Source struct {
	Images    []DishImage `json:"images,omitempty"`
	Title     string      `json:"title"`
	URL       string      `json:"url"`
	Snippet   string      `json:"snippet"`
	Summary   string      `json:"summary"`
	Content   string      `json:"content,omitempty"`
	SiteName  *string     `json:"site_name"`
	Date      *string     `json:"date"`
	Score     float64     `json:"rerank_score"`
	Authority int         `json:"authority"`
}

var DefaultTags = []string{"汤", "下饭菜", "减脂餐", "家常菜", "快手菜", "低脂", "高蛋白", "清淡", "素食", "低碳水", "高纤维", "增肌餐", "少油", "少盐", "少糖", "无辣", "微辣", "重辣", "高饱腹感", "低预算", "儿童友好"}

// Recipe is a complete menu snapshot; the recipes API name is retained for compatibility.
type TokenUsage struct {
	Model        string `json:"model"`
	InputTokens  int64  `json:"input_tokens"`
	OutputTokens int64  `json:"output_tokens"`
	TotalTokens  int64  `json:"total_tokens"`
	Calls        int    `json:"calls"`
	MissingCalls int    `json:"missing_calls"`
}

type Recipe struct {
	TokenUsage    *TokenUsage `json:"token_usage,omitempty"`
	Tags          []string    `json:"tags"`
	Title         string      `json:"title"`
	Summary       string      `json:"summary"`
	Servings      int         `json:"servings"`
	Dishes        []Dish      `json:"dishes"`
	Elapsed       float64     `json:"total_elapsed_minutes"`
	Commentary    string      `json:"ai_commentary"`
	Tips          []string    `json:"tips"`
	Substitutions []string    `json:"substitutions"`
	Usage         []Usage     `json:"energy_usage"`
	Sources       []Source    `json:"sources"`
	Warnings      []string    `json:"warnings"`
	Cost          float64     `json:"total_cost"`
	PurchaseCost  float64     `json:"purchase_cost"`
	UnknownPrices int         `json:"unknown_prices"`
	Nutrition     Nutrition   `json:"nutrition"`
	KWh           float64     `json:"theoretical_kwh"`
	EnergyCost    float64     `json:"theoretical_energy_cost"`
	Favorite      bool        `json:"favorite"`
	Saved         bool        `json:"saved"`
	Rating        int         `json:"rating"`
	Feedback      string      `json:"feedback"`
	ParentID      uint        `json:"parent_id"`
	Request       Request     `json:"request"`
}

// DishRecord is an independent snapshot; removing its source menu cannot remove it.
type DishRecord struct {
	TokenUsage *TokenUsage `json:"token_usage,omitempty"`
	Warnings   []string    `json:"warnings"`
	Dish
	Servings int      `json:"servings"`
	Saved    bool     `json:"saved"`
	Favorite bool     `json:"favorite"`
	Sources  []Source `json:"sources"`
	Request  Request  `json:"request"`
}
